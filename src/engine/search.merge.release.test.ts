/**
 * The merge's release rule (Checkpoint 7f; search.ts, "Merged cards"; the review of the merge, MERGE-5: no search had ever
 * given a trade back, on Parker's dumps or 1,369 synthetic searches, so its path ran in no test). A narrow hook drives it:
 * the three offers.ts functions the merge calls (ladderNeighbors, offerFeasible, searchLadderChoiceSteps) are replaced, in
 * this file only, by a made-up plan on a real search's first three cards, X1 > X2 > X3 on Overall: X2's offers hold X3, and
 * X1's hold X2, X1 needing its ladder only once X3 is off the list. Round 1 merges X3 into X2; round 2 merges X2 into X1;
 * round 3 merges none, and no card above X3 holds it (its card, X2, is merged in turn), so X3 comes back for good (the
 * release rule) while X2 stays X1's; round 4 shows X3 again and merges none. Then the list rule holds (no card's offers hold
 * a card of its list below it, every merged trade an offer of a card above it), the counts and progress add up, and a
 * re-filter there and back equals a fresh search under the same plan (synthetic leagues: made-up players, placeholder teams).
 * Since Checkpoint 7g the plan runs without the dropped versions (TradeSearchOptions.dropDominated false: on smallLeague 48 the
 * rule drops a version in a round of its own, its own path, which search.dominated.test.ts drives on the league's real
 * ladders: a dropped card that held a merged trade gives it back), and its merge goes top-down (preferListed, the app's).
 */
import { describe, expect, it, vi } from "vitest";

/** The made-up plan (null: the real functions), set by the test around each search. */
const plan = vi.hoisted(() => ({ cards: null as { x1: string; x2: string; x3: string } | null, ladders: 0 }));

vi.mock("./offers", async (importOriginal) => {
  const real = await importOriginal<typeof import("./offers")>();
  const ladderNeighbors: typeof real.ladderNeighbors = (state, card, listed) => {
    const p = plan.cards;
    if (!p) return real.ladderNeighbors(state, card, listed);
    const keys = new Set(listed.map((n) => n.key));
    if (card.key === p.x2 && keys.has(p.x3)) return [{ key: p.x3, kind: "earlier" }];
    if (card.key === p.x1 && keys.has(p.x2) && !keys.has(p.x3)) return [{ key: p.x2, kind: "earlier" }];
    return [];
  };
  const offerFeasible: typeof real.offerFeasible = (k, n, kind, minChance) => (plan.cards ? true : real.offerFeasible(k, n, kind, minChance));
  const searchLadderChoiceSteps: typeof real.searchLadderChoiceSteps = function* (job) {
    const p = plan.cards;
    if (!p) return yield* real.searchLadderChoiceSteps(job);
    plan.ladders++;
    // One step, as a ladder's exact evaluation would be (a progress unit and a yield), then the planned choice: the trade
    // it holds as its Open, with the numbers that trade prints (the search's, as a ladder reads them).
    yield;
    const held = job.card.key === p.x2 ? p.x3 : job.card.key === p.x1 ? p.x2 : null;
    if (!held) return null;
    const printed = job.store.known?.get(held);
    if (!printed) throw new Error(`no printed numbers for ${held}`);
    return { open: { candidate: { kind: "variant", key: held, proposal: printed.proposal }, printed }, thens: [], last: null, screened: [], candidates: 1 };
  };
  return { ...real, ladderNeighbors, offerFeasible, searchLadderChoiceSteps };
});

// search.ts first: it loads offers.ts (this file's mock, whose factory loads the real one), so its own import of the three
// functions is the mock's. Loaded the other way round, the real offers.ts would load search.ts inside the factory, and
// search.ts would read the real functions.
import { runRefilter, runTradeSearch, searchStateOf, type SearchState } from "./search";
import { buildTradeContext } from "./evaluate";
import { offerLadderOfSearch } from "./offers";
import { compareOverall } from "./rank";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { OfferLadder, TradeSearchProgress, TradeSearchResult } from "./tradeModel";

const at = (minChance: number): TradeSettings => ({ ...defaultTradeSettings(), minChance });
const keysOf = (ts: readonly { key: string }[]) => ts.map((t) => t.key);

/** A search under the plan on the first three cards of the same search without the merge (its Overall list as printed). */
function underPlan(cards: { x1: string; x2: string; x3: string }, run: () => TradeSearchResult): TradeSearchResult {
  plan.cards = cards;
  plan.ladders = 0;
  try {
    return run();
  } finally {
    plan.cards = null;
  }
}

describe("the merge's release rule: a merged trade whose card is merged in turn, and that no card above it holds, comes back for good (Checkpoint 7f; the review of the merge, MERGE-5)", { timeout: 300_000 }, () => {
  // smallLeague 48 (6 teams) at 10%: its Overall list without the merge has at least three cards, none of the first three on
  // the "Helps both" list (a fact of the synthetic data, checked below).
  const SEED = 48;
  const MIN = 0.1;
  const league = smallLeague(SEED, {}, 6);
  const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
  const plain = runTradeSearch(ctx, { settings: at(MIN), mergeCards: false });

  it("round by round: X3 merged into X2, X2 into X1, X3 given back and shown again; the list rule, the counts and the progress after it", () => {
    expect(plain.trades.length).toBeGreaterThanOrEqual(3);
    const [x1, x2, x3] = plain.trades.map((t) => t.key) as [string, string, string];
    const both = new Set(keysOf(plain.helpsBoth?.trades ?? []));
    expect([x1, x2, x3].some((k) => both.has(k))).toBe(false);
    const cards = { x1, x2, x3 };
    const progress: TradeSearchProgress[] = [];
    const r = underPlan(cards, () => runTradeSearch(ctx, { settings: at(MIN), dropDominated: false }, (p) => progress.push(p)));
    const st = searchStateOf(r) as SearchState;
    const merged = r.merged;
    if (!merged) throw new Error("no merge");

    // X2 stays merged into X1 (round 2); X3, merged into X2 in round 1, came back for good: one trade given back, 4 rounds.
    expect(merged.overall).toEqual([{ key: x2, into: x1, kind: "open" }]);
    expect(merged.helpsBoth).toEqual([]);
    expect(merged.released).toBe(1);
    expect(merged.rounds.overall).toBe(4);
    expect(plan.ladders).toBe(2);
    // X3 is a card again, X2 isn't; X1 holds X2 among its offers, the ladder the merge read kept for it.
    const listed = keysOf(r.trades);
    expect(listed).toContain(x1);
    expect(listed).toContain(x3);
    expect(listed).not.toContain(x2);
    const ladder = offerLadderOfSearch(r, x1) as OfferLadder;
    expect(st.ladders?.get(x1)).toBe(ladder);
    expect(ladder.steps.map((s) => [s.kind, s.evaluation.key])).toEqual([["open", x2], ["suggested", x1]]);

    // The list rule after it: no card's offers (the planned choices, as the merge read them) hold a card of its list below
    // it, and every merged trade is an offer of a card above it on its list.
    const offersOf = (key: string): string[] => (key === x2 ? [x3] : key === x1 ? [x2] : []);
    const byKey = new Map(r.trades.map((t) => [t.key, t]));
    for (const c of r.trades) {
      for (const o of offersOf(c.key)) {
        const other = byKey.get(o);
        if (other) expect(compareOverall(other, c), `${c.key} holds ${o}`).toBeLessThan(0);
      }
    }
    for (const m of merged.overall) {
      const keeper = byKey.get(m.into);
      expect(keeper, m.key).toBeDefined();
      expect(offersOf(m.into)).toContain(m.key);
    }
    // The counts: the merged trade among those the rules left out and the qualifying, as without the merge.
    expect(r.dropped?.merged).toBe(1);
    expect(r.filter?.qualifying).toBe(plain.filter?.qualifying);

    // Progress: never back, the merge's ladder steps read part "offers", and the last event is the count itself, every unit
    // done (a card the rounds took off its list left its Plan B's unit out of the total).
    const rank = progress.filter((p) => p.stage === "rank");
    for (let i = 1; i < rank.length; i++) {
      const a = rank[i - 1] as TradeSearchProgress;
      const b = rank[i] as TradeSearchProgress;
      expect(b.done / b.total, `step ${i}`).toBeGreaterThanOrEqual(a.done / a.total - 1e-12);
    }
    expect(rank.filter((p) => p.part === "offers")).toHaveLength(2);
    const last = rank.at(-1) as TradeSearchProgress;
    expect(last.done).toBe(last.total);
    expect(last.part).toBe("shown");
  });

  it("deterministic under the plan, and a re-filter there and back equals a fresh search, the trade given back included", () => {
    const [x1, x2, x3] = plain.trades.map((t) => t.key) as [string, string, string];
    const cards = { x1, x2, x3 };
    const r = underPlan(cards, () => runTradeSearch(ctx, { settings: at(MIN), dropDominated: false }));
    const again = underPlan(cards, () => runTradeSearch(buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 }), { settings: at(MIN), dropDominated: false }));
    expect(again).toEqual(r);
    const there = underPlan(cards, () => runRefilter(ctx, searchStateOf(r) as SearchState, { minChance: 0 }));
    expect(there).toEqual(underPlan(cards, () => runTradeSearch(ctx, { settings: at(0), dropDominated: false })));
    const back = underPlan(cards, () => runRefilter(ctx, searchStateOf(there) as SearchState, { minChance: MIN }));
    expect(back).toEqual(r);
  });
});
