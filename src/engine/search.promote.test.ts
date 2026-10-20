/**
 * Promoted Last offers and the narrowed preference (Checkpoint 7h; planner reply to Checkpoint 7g, answers 3 and 4: "When an
 * offer list finds a version with a higher Overall than the idea it sits under: that version becomes the idea; the original
 * becomes its "Open with" step, the bigger ask." and "Prefer an idea from the list only when its Helps you is within 3 points
 * of the best version that meets the step's rules. Otherwise take the best version."; search.ts, "Promoted Last offers";
 * offers.ts, "The promoted card's Open" and "Preferring the cards of its lists"): narrowedPick and forcedOpenOk on made-up
 * numbers; on whole searches each promoted card on its list with its original merged into it as its forced Open (marked
 * `original`), printing a lower Overall than it; no card shown whose Last offer prints a higher Overall than it but those
 * MergedCards.notPromoted names; the higher Opens and Thens counted, never promoted; the result's offerOpen; the switch off
 * giving the original as a card with its Last offer; the worker's fallback (offerLadderOfProposal with `open`) equal to the
 * kept ladder; a re-filter there and back equal to a fresh search; the Trade Analyzer's ladder for the original promoting
 * nothing. Synthetic leagues (trade.testing.ts smallLeague: made-up players, placeholder teams); which seeds promote is a
 * fact of the synthetic data, found on this tree (6 teams at 10%: 5 and 8 on the Overall list, a smaller ask and a throw-in;
 * 4 and 24 on "Helps both").
 */
import { describe, expect, it } from "vitest";
import { displayAcceptance } from "./acceptance";
import { config } from "./config";
import { buildTradeContext, type TradeContext } from "./evaluate";
import { forcedOpenOk, narrowedPick, offerLadderOfProposal, offerLadderOfSearch } from "./offers";
import { runRefilter, runTradeSearch, searchStateOf, type SearchState } from "./search";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { OfferLadder, TradeEvaluation, TradeEvaluationCore, TradeSearchResult } from "./tradeModel";

const at = (minChance: number): TradeSettings => ({ ...defaultTradeSettings(), minChance });
const eg = (e: Pick<TradeEvaluationCore, "b" | "pComplete">): number => (e.b === null ? Number.NEGATIVE_INFINITY : e.b * e.pComplete);

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
const freshContext = (seed: number): TradeContext => {
  const league = smallLeague(seed, {}, 6);
  return buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
};
const searches = new Map<string, TradeSearchResult>();
function search(seed: number, extra: { promoteLastOffers?: boolean } = {}): TradeSearchResult {
  const key = `${seed}|${JSON.stringify(extra)}`;
  let r = searches.get(key);
  if (!r) {
    r = runTradeSearch(contextOf(seed), { settings: at(0.1), ...extra });
    searches.set(key, r);
  }
  return r;
}
const listOf = (r: TradeSearchResult, name: "overall" | "helpsBoth"): TradeEvaluation[] => (name === "overall" ? r.trades : (r.helpsBoth?.trades ?? []));
/** A ladder with the partner's numbers to 12 significant digits (search.merge.test.ts ulpsInThem: Checkpoint 7f's resume). */
function ulpsInThem(ladder: OfferLadder | null): unknown {
  const round = (v: unknown): unknown =>
    typeof v === "number" && Number.isFinite(v) ? Number(v.toPrecision(12)) : Array.isArray(v) ? v.map(round) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v;
  return JSON.parse(JSON.stringify(ladder, (k, v) => (k === "them" || k === "ms" ? (k === "ms" ? undefined : round(v)) : v)));
}

describe("narrowedPick and forcedOpenOk (made-up numbers)", () => {
  const pick = (helps: number | null) => ({ printed: { tradeScore: helps } as Pick<TradeEvaluationCore, "tradeScore"> });

  it("the preferred pick only within config.offers.preferWithinHelps of the usual pick's Helps you, as printed; alone, either one", () => {
    const w = config.offers.preferWithinHelps;
    expect(w).toBe(3);
    const usual = pick(70);
    expect(narrowedPick(pick(70 - w), usual)?.printed.tradeScore).toBe(70 - w);
    expect(narrowedPick(pick(70 - w - 1), usual)).toBe(usual);
    expect(narrowedPick(pick(75), usual)?.printed.tradeScore).toBe(75);
    expect(narrowedPick(null, usual)).toBe(usual);
    const only = pick(10);
    expect(narrowedPick(only, null)).toBe(only);
    expect(narrowedPick(null, null)).toBeNull();
    // A pick without a printed Helps you never wins over the usual one.
    expect(narrowedPick(pick(null), usual)).toBe(usual);
  });

  it("forcedOpenOk: an Open's rules but its least chance (likelier than the card less minAcceptGain, better for me), the minimum chance, and Helps both under a tagged card", () => {
    const gain = config.search.steps.minAcceptGain;
    const card = { key: "c", b: 2, pComplete: 0.5, tradeScore: 40, pAccept: 0.5, illegal: null, flags: { hiddenByMarket: false }, them: undefined } as unknown as TradeEvaluationCore;
    const original = (over: Partial<TradeEvaluationCore>) => ({ ...card, key: "o", b: 3, pComplete: 0.5 - gain, tradeScore: 50, ...over }) as TradeEvaluationCore;
    expect(forcedOpenOk(card, original({}), 0.1)).toBe(true);
    // Under the Open's 15% floor: still an Open here (the floor is the one rule a forced Open skips), not under the minimum chance.
    expect(forcedOpenOk(card, original({ pComplete: 0.12 }), 0.1)).toBe(true);
    expect(forcedOpenOk(card, original({ pComplete: 0.12 }), 0.15)).toBe(false);
    expect(forcedOpenOk(card, original({ pComplete: 0.5 - gain + 0.03 }), 0.1)).toBe(false);
    expect(forcedOpenOk(card, original({ tradeScore: 39 }), 0.1)).toBe(false);
    expect(forcedOpenOk(card, original({ b: 2 }), 0.1)).toBe(false);
    expect(forcedOpenOk(card, original({ b: -1, tradeScore: 0 }), 0.1)).toBe(false);
  });
});

describe("promoted Last offers on whole searches (Checkpoint 7h)", { timeout: 900_000 }, () => {
  const PROMOTING = [
    { seed: 5, list: "overall", kind: "smaller" },
    { seed: 8, list: "overall", kind: "throwIn" },
    { seed: 4, list: "helpsBoth", kind: "throwIn" },
    { seed: 24, list: "helpsBoth", kind: "smaller" },
  ] as const;

  it("each promoted card is on its list, its original merged into it as its forced Open (marked), printing a lower Overall; offerOpen says so", () => {
    for (const { seed, list, kind } of PROMOTING) {
      const r = search(seed);
      const st = searchStateOf(r) as SearchState;
      const promoted = (r.merged?.promoted ?? []).filter((p) => p.list === list && p.kind === kind);
      expect(promoted.length, `smallLeague ${seed}: a ${kind} promoted on ${list}`).toBeGreaterThan(0);
      for (const p of r.merged?.promoted ?? []) {
        const w = `smallLeague ${seed} ${p.list}: ${p.key} from ${p.from}`;
        const cards = listOf(r, p.list);
        expect(cards.map((t) => t.key), w).toContain(p.key);
        expect(cards.map((t) => t.key), w).not.toContain(p.from);
        const merged = p.list === "overall" ? r.merged?.overall : r.merged?.helpsBoth;
        expect(merged, w).toContainEqual({ key: p.from, into: p.key, kind: "open" });
        const ladder = offerLadderOfSearch(r, p.key) as OfferLadder;
        const open = ladder.steps[0];
        expect(open?.kind, w).toBe("open");
        expect(open?.evaluation.key, w).toBe(p.from);
        expect(open?.original, w).toBe(true);
        expect(ladder.steps.filter((s) => s.original).length, w).toBe(1);
        expect(eg(st.shownByKey.get(p.key) as TradeEvaluationCore), w).toBeGreaterThan(eg(st.shownByKey.get(p.from) as TradeEvaluationCore));
        expect(r.offerOpen?.[p.key], w).toBe(p.from);
        // Its forced Open prints at least the user's minimum chance (as printed, the nearest 5%: the minimum chance's reading).
        expect(displayAcceptance(open?.evaluation.pComplete as number), w).toBeGreaterThanOrEqual(0.1 - 1e-9);
      }
      expect(r.merged?.superseded).toBe(0);
    }
  });

  it("no card shown has a Last offer printing a higher Overall than it but those notPromoted names; the higher Opens and Thens are counted, never promoted", () => {
    for (const seed of [1, 4, 5, 8, 24]) {
      const r = search(seed);
      for (const name of ["overall", "helpsBoth"] as const) {
        const named = new Set((r.merged?.notPromoted ?? []).filter((n) => n.list === name).map((n) => n.card));
        for (const c of listOf(r, name)) {
          const last = (offerLadderOfSearch(r, c.key) as OfferLadder).steps.find((s) => s.kind === "last");
          if (last && eg(last.evaluation) > eg(c) + 1e-9) expect(named.has(c.key), `smallLeague ${seed} ${name}: ${c.key}`).toBe(true);
        }
      }
      for (const n of r.merged?.notPromoted ?? []) expect(["card", "shown", "taken", "released", "open", "rules"]).toContain(n.reason);
      const cards = new Map([...r.trades, ...(r.helpsBoth?.trades ?? [])].map((t) => [t.key, t]));
      for (const h of r.merged?.higherEarlier ?? []) {
        const card = cards.get(h.card) as TradeEvaluation;
        const step = (offerLadderOfSearch(r, h.card) as OfferLadder).steps.find((s) => s.evaluation.key === h.offer);
        expect(step?.kind).toBe(h.kind);
        expect(step?.original).toBeUndefined();
        expect(eg(step?.evaluation as TradeEvaluation)).toBeGreaterThan(eg(card));
      }
    }
    // smallLeague 1: 7 Last offers the lists' own rules wouldn't keep as cards (a fact of the synthetic data).
    expect((search(1).merged?.notPromoted ?? []).filter((n) => n.reason === "rules").length).toBeGreaterThan(0);
  });

  it("with the switch off (TradeSearchOptions.promoteLastOffers false) the original is a card and the promoted trade its Last offer, and nothing is said of a promotion", () => {
    for (const { seed } of PROMOTING) {
      const r = search(seed);
      const off = search(seed, { promoteLastOffers: false });
      expect(off.merged?.promoted).toBeUndefined();
      expect(off.merged?.notPromoted).toBeUndefined();
      expect(off.merged?.higherEarlier).toBeUndefined();
      expect(off.offerOpen).toBeUndefined();
      for (const p of r.merged?.promoted ?? []) {
        const cards = listOf(off, p.list).map((t) => t.key);
        if (!cards.includes(p.from)) continue; // a later promotion's original can be a card only after an earlier one
        const last = (offerLadderOfSearch(off, p.from) as OfferLadder).steps.find((s) => s.kind === "last");
        expect(last?.evaluation.key, `smallLeague ${seed}: ${p.from}`).toBe(p.key);
        expect(cards).not.toContain(p.key);
      }
    }
  });

  it("the worker's fallback with the recorded forced Open equals the kept ladder (and differs without it); the Analyzer's ladder for the original promotes nothing", () => {
    for (const { seed } of PROMOTING) {
      const r = search(seed);
      const st = searchStateOf(r) as SearchState;
      const settings = at(0.1);
      const fresh = freshContext(seed);
      for (const p of r.merged?.promoted ?? []) {
        const card = [...r.trades, ...(r.helpsBoth?.trades ?? [])].find((t) => t.key === p.key) as TradeEvaluation;
        const prefer = st.prefers?.get(p.key);
        const kept = st.ladders?.get(p.key) as OfferLadder;
        expect(kept, `${seed}: ${p.key} kept`).toBeDefined();
        const fallback = offerLadderOfProposal(fresh, card.proposal, { settings, page: "finder", open: p.from, ...(prefer ? { prefer } : {}) });
        expect(ulpsInThem(fallback), `${seed}: ${p.key}`).toEqual(ulpsInThem(kept));
        const without = offerLadderOfProposal(fresh, card.proposal, { settings, page: "finder", ...(prefer ? { prefer } : {}) });
        expect(without?.steps.some((s) => s.original)).toBe(false);
        // The Analyzer's ladder for the idea it came from: its Last offer is the promoted trade, nothing promoted.
        const original = st.shownByKey.get(p.from) as TradeEvaluationCore;
        const analyzer = offerLadderOfProposal(fresh, original.proposal, { settings, page: "analysis" });
        expect(analyzer?.steps.some((s) => s.original)).toBe(false);
      }
    }
  });

  it("a re-filter there and back equals a fresh search, its promotions, forced Opens and kept ladders included", () => {
    for (const seed of [5, 4]) {
      const ctx = contextOf(seed);
      const r = search(seed);
      const st = searchStateOf(r) as SearchState;
      for (const other of [0, 0.2]) {
        const there = runRefilter(ctx, st, { minChance: other });
        expect(there).toEqual(runTradeSearch(ctx, { settings: at(other) }));
        const back = runRefilter(ctx, searchStateOf(there) as SearchState, { minChance: 0.1 });
        expect(back).toEqual(r);
        expect(searchStateOf(back)?.opens).toEqual(st.opens);
        expect(searchStateOf(back)?.ladders).toEqual(st.ladders);
      }
    }
  });
});
