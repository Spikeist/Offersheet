/**
 * An undone promotion on one list leaves the other list's promotion of the same pair alone (Checkpoint 7h's second review,
 * offers#3, found by its verifier; search.ts, "Promoted Last offers", "Undone"). Both lists can promote the same Last offer P
 * from the same idea O (a Last offer is promoted on both lists only from the same idea), and the forced Open, the ladder and the
 * preference are the search's, one for both lists. When the "Helps both" list then undoes its own promotion (a card above P
 * takes it among its offers, so O is given back there), the Overall list's promotion still stands: P is a card there with O
 * merged into it as its "open", so P keeps its forced Open (TradeSearchResult.offerOpen) and its ladder, which opens with O.
 * Cleared at once, P had lost both, and O, recorded as merged into P on the Overall list, showed nowhere there.
 *
 * No search seen has done both (about 1,750 traced searches had a pair promoted on both lists once, smallLeague 30, Team 3,
 * Any, and a "Helps both" undo once, never together), so a narrow hook drives it, as search.merge.release.test.ts drives the
 * release rule: on smallLeague 30 (made-up players, placeholder teams), Team 3, Any, where both lists promote
 * P = 3|give:1003|get:1036 from O = 3|give:1003|get:1031,1036, the "Helps both" card K = 3|give:1002,1005|get:1031,1036 (on that
 * list alone, above P on Overall as printed) gets a made-up ladder whose Open is P (the three offers.ts functions the merge
 * calls, replaced in this file for K alone); every other ladder is the real one.
 */
import { describe, expect, it, vi } from "vitest";

/** The made-up plan (null: the real functions), set by the test around each search: K's ladder holds P as its Open. */
const plan = vi.hoisted(() => ({ cards: null as { k: string; p: string } | null, ladders: 0 }));

vi.mock("./offers", async (importOriginal) => {
  const real = await importOriginal<typeof import("./offers")>();
  const ladderNeighbors: typeof real.ladderNeighbors = (state, card, listed) => {
    const c = plan.cards;
    if (!c || card.key !== c.k) return real.ladderNeighbors(state, card, listed);
    return listed.some((n) => n.key === c.p) ? [{ key: c.p, kind: "earlier" }] : [];
  };
  const offerFeasible: typeof real.offerFeasible = (k, n, kind, minChance) => (plan.cards && k.key === plan.cards.k && n.key === plan.cards.p ? true : real.offerFeasible(k, n, kind, minChance));
  const searchLadderChoiceSteps: typeof real.searchLadderChoiceSteps = function* (job) {
    const c = plan.cards;
    if (!c || job.card.key !== c.k) return yield* real.searchLadderChoiceSteps(job);
    plan.ladders++;
    // One step, as a ladder's exact evaluation would be (a progress unit and a yield), then the planned choice: P as its
    // Open, with the numbers P prints (the search's, as a ladder reads them).
    yield;
    const printed = job.store.known?.get(c.p);
    if (!printed) throw new Error(`no printed numbers for ${c.p}`);
    return { open: { candidate: { kind: "variant", key: c.p, proposal: printed.proposal }, printed }, thens: [], last: null, screened: [], candidates: 1 };
  };
  return { ...real, ladderNeighbors, offerFeasible, searchLadderChoiceSteps };
});

// search.ts first: it loads offers.ts (this file's mock, whose factory loads the real one), so its own import of the three
// functions is the mock's (search.merge.release.test.ts says why the order matters).
import { runRefilter, runTradeSearch, searchStateOf, type SearchState } from "./search";
import { buildTradeContext } from "./evaluate";
import { offerLadderOfSearch } from "./offers";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { OfferLadder, TradeSearchResult } from "./tradeModel";

const at = (minChance: number): TradeSettings => ({ ...defaultTradeSettings(), minChance });
const keysOf = (ts: readonly { key: string }[] | undefined): string[] => (ts ?? []).map((t) => t.key);
const stepsOf = (ladder: OfferLadder | null | undefined): string[] => (ladder?.steps ?? []).map((s) => `${s.kind}${s.original ? "*" : ""}:${s.evaluation.key}`);

/** Every promotion the result names stands on its list (search.promote.undo.test.ts's check), its forced Open carried. */
function standing(r: TradeSearchResult): void {
  const m = r.merged;
  for (const p of m?.promoted ?? []) {
    const cards = p.list === "overall" ? r.trades : (r.helpsBoth?.trades ?? []);
    const merged = p.list === "overall" ? m?.overall : m?.helpsBoth;
    expect(keysOf(cards), p.key).toContain(p.key);
    expect(merged?.find((x) => x.key === p.from), p.from).toEqual({ key: p.from, into: p.key, kind: "open" });
    expect(r.offerOpen?.[p.key], p.key).toBe(p.from);
  }
  for (const [card, from] of Object.entries(r.offerOpen ?? {})) expect(m?.promoted?.some((p) => p.key === card && p.from === from)).toBe(true);
}

describe("an undone promotion on the \"Helps both\" list leaves the Overall list's promotion of the same pair standing (offers#3)", { timeout: 300_000 }, () => {
  const league = smallLeague(30, {}, 6);
  const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
  const TEAM = "3";
  const O = "3|give:1003|get:1031,1036";
  const P = "3|give:1003|get:1036";
  const K = "3|give:1002,1005|get:1031,1036";
  const cards = { k: K, p: P };
  const search = (minChance: number) => runTradeSearch(ctx, { settings: at(minChance), partnerId: TEAM });
  function underPlan<T>(run: () => T): T {
    plan.cards = cards;
    plan.ladders = 0;
    try {
      return run();
    } finally {
      plan.cards = null;
    }
  }
  const real = search(0);

  it("the data: without the plan both lists promote P from O, and K is a \"Helps both\" card alone, above P on Overall", () => {
    expect(real.merged?.promoted).toEqual([
      { key: P, from: O, list: "overall", kind: "smaller" },
      { key: P, from: O, list: "helpsBoth", kind: "smaller" },
    ]);
    standing(real);
    expect(stepsOf(offerLadderOfSearch(real, P))).toEqual([`open*:${O}`, `suggested:${P}`]);
    const k = real.helpsBoth?.trades.find((t) => t.key === K);
    const p = real.trades.find((t) => t.key === P);
    if (!k || !p || k.b === null || p.b === null) throw new Error("K or P isn't shown with a B");
    expect(keysOf(real.trades)).not.toContain(K);
    expect(k.b * k.pComplete).toBeGreaterThan(p.b * p.pComplete);
  });

  it("with K's ladder holding P: the \"Helps both\" list undoes its promotion, and the Overall list's keeps its forced Open and its ladder", () => {
    const r = underPlan(() => search(0));
    expect(plan.ladders).toBeGreaterThanOrEqual(1);
    const st = searchStateOf(r) as SearchState;

    // The "Helps both" list undid its own: no record of it, O given back there (a card again, never merged again).
    expect(r.merged?.promoted).toEqual([{ key: P, from: O, list: "overall", kind: "smaller" }]);
    expect(r.merged?.helpsBoth).toEqual([]);
    expect(keysOf(r.helpsBoth?.trades)).toContain(O);
    expect(keysOf(r.helpsBoth?.trades)).not.toContain(P);
    expect(r.merged?.notPromoted).toContainEqual({ card: O, offer: P, list: "helpsBoth", reason: "released" });

    // The Overall list's promotion stands as without the plan: the same cards, O merged into P as its "open", P's forced Open
    // and its kept ladder (the one the result hands back, and the worker's fallback reads offerOpen) opening with O.
    standing(r);
    expect(keysOf(r.trades)).toEqual(keysOf(real.trades));
    expect(r.merged?.overall).toEqual(real.merged?.overall);
    expect(r.offerOpen).toEqual({ [P]: O });
    const ladder = offerLadderOfSearch(r, P);
    expect(st.ladders?.get(P)).toBe(ladder);
    expect(stepsOf(ladder)).toEqual([`open*:${O}`, `suggested:${P}`]);
    expect(ladder).toEqual(offerLadderOfSearch(real, P));
  });

  it("deterministic under the plan, and a re-filter there and back equals a fresh search", () => {
    const r = underPlan(() => search(0));
    const fresh = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
    expect(underPlan(() => runTradeSearch(fresh, { settings: at(0), partnerId: TEAM }))).toEqual(r);
    const there = underPlan(() => runRefilter(ctx, searchStateOf(r) as SearchState, { minChance: 0.1 }));
    expect(there).toEqual(underPlan(() => search(0.1)));
    const back = underPlan(() => runRefilter(ctx, searchStateOf(there) as SearchState, { minChance: 0 }));
    expect(back).toEqual(r);
    standing(back);
  });
});
