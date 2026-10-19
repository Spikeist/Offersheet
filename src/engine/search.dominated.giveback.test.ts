/**
 * A dropped version given back (Checkpoint 7g's final review, E2, merge-c-by-can-leave; search.ts, "Merged cards, Checkpoint 7g"):
 * once a round merges none, drops none and gives no merged trade back, a dropped version whose `by` is no longer a card of its
 * list or a trade merged into one is re-pointed to another version that beats it, else given back for good, never dropped
 * again (MergedCards.restored). The re-pointing shows on real data (search.dominated.test.ts: smallLeague 29 searched with Team 5
 * at "Any"); the give-back never did (none in the fix's 687 searches: Parker's seven runs, smallLeague 1–60 at 10% and at Any,
 * 12-team 1–8 at Any and at 10%, and searches of each other team alone in smallLeague 1–60 at 10%, 1–40 at Any and 12-team 1–4
 * at Any), so a narrow hook drives it, as
 * search.merge.release.test.ts drives the release rule: rank.ts versionsOfSameTrade, the relation rule (c) reads, is replaced in
 * this file only by a made-up plan on three cards of a real search's Overall list, Z > Y > X on Helps you at one printed chance
 * (smallLeague 1 at 10%, where nothing merges or drops: facts of the synthetic data, checked below). First only Y and X are
 * versions of one trade, so round 1 drops X for Y; from then on Z and Y are too, so round 2 drops Y for Z; Z and X never are, so
 * round 3 gives X back (its `by`, Y, left; nothing else beats it) and round 4 settles. Then X is a card again, Y stays dropped for
 * Z, the counts add up, and a re-filter there and back equals a fresh search under the same plan (synthetic leagues: made-up
 * players, placeholder teams).
 */
import { describe, expect, it, vi } from "vitest";

/** The made-up plan (null: the real relation), set by the test around each search. */
const plan = vi.hoisted(() => ({ cards: null as { x: string; y: string; z: string } | null, phase: 1, zx: 0 }));

vi.mock("./rank", async (importOriginal) => {
  const real = await importOriginal<typeof import("./rank")>();
  const versionsOfSameTrade: typeof real.versionsOfSameTrade = (a, b) => {
    const p = plan.cards;
    if (!p) return real.versionsOfSameTrade(a, b);
    const ka = (a as { key?: string }).key;
    const kb = (b as { key?: string }).key;
    const pair = (u: string, v: string) => (ka === u && kb === v) || (ka === v && kb === u);
    if (pair(p.y, p.x)) {
      // The first time rule (c) finds Y beats X, X drops; Z and Y are versions of one trade from the next pass on.
      plan.phase = 2;
      return true;
    }
    if (pair(p.z, p.y)) return plan.phase >= 2;
    // Z and X: asked when round 1 decides X (no), when the give-back looks for another version beating X (no, so X comes back),
    // and from then on yes: only the rule that a version given back is never dropped again (search.ts `restored`) keeps X on
    // the list, since with it nothing asks again.
    if (pair(p.z, p.x)) return ++plan.zx > 2;
    return false;
  };
  return { ...real, versionsOfSameTrade };
});

// search.ts first: it loads rank.ts (this file's mock, whose factory loads the real one), so its own import of the relation is
// the mock's.
import { runRefilter, runTradeSearch, searchStateOf, type SearchState } from "./search";
import { printedAcceptance } from "./acceptance";
import { buildTradeContext } from "./evaluate";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { TradeEvaluation, TradeSearchResult } from "./tradeModel";

const at = (minChance: number): TradeSettings => ({ ...defaultTradeSettings(), minChance });
const keysOf = (ts: readonly { key: string }[]) => ts.map((t) => t.key);

/** A search under the plan (its phase back to 1 for each search or re-filter: each settles its lists afresh). */
function underPlan(cards: { x: string; y: string; z: string }, run: () => TradeSearchResult): TradeSearchResult {
  plan.cards = cards;
  plan.phase = 1;
  plan.zx = 0;
  try {
    return run();
  } finally {
    plan.cards = null;
  }
}

describe("a dropped version whose `by` leaves, and no other version beats it, comes back for good (the final review, E2)", { timeout: 300_000 }, () => {
  // smallLeague 1 (6 teams) at 10%: its Overall list holds the three cards below, at 10% each, Helps you 85 > 83 > 80, none on
  // the "Helps both" list, and the search merges and drops nothing (facts of the synthetic data, checked below).
  const SEED = 1;
  const MIN = 0.1;
  const cards = { z: "6|give:1005|get:1063,1064", y: "6|give:1012|get:1063", x: "4|give:1005|get:1041,1044" };
  const league = smallLeague(SEED, {}, 6);
  const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
  const plain = runTradeSearch(ctx, { settings: at(MIN) });

  it("round by round: X dropped for Y, Y for Z, X given back and shown again; the counts after it", () => {
    const byKey = new Map(plain.trades.map((t) => [t.key, t]));
    const [z, y, x] = [cards.z, cards.y, cards.x].map((k) => byKey.get(k)) as (TradeEvaluation | undefined)[];
    if (!z || !y || !x) throw new Error(`smallLeague ${SEED} no longer shows the three cards: pick another three`);
    expect([z, y, x].map((t) => t.tradeScore)).toEqual([85, 83, 80]);
    expect(new Set([z, y, x].map((t) => printedAcceptance(t.pComplete)))).toEqual(new Set([0.1]));
    expect(keysOf(plain.helpsBoth?.trades ?? []).some((k) => Object.values(cards).includes(k))).toBe(false);
    expect([plain.merged?.overall, plain.merged?.helpsBoth, plain.merged?.dominated]).toEqual([[], [], []]);

    const r = underPlan(cards, () => runTradeSearch(ctx, { settings: at(MIN) }));
    const merged = r.merged;
    if (!merged) throw new Error("no merge");
    // Y stays dropped, its `by` Z a card of the list; X, dropped for Y in round 1, came back in round 3, its `by` gone and Z no
    // version of it: given back for good. Four rounds: X dropped, Y dropped, X given back, settled.
    expect(merged.dominated).toEqual([{ key: cards.y, by: cards.z, list: "overall" }]);
    expect(merged.restored).toBe(1);
    expect(merged.released).toBe(0);
    expect(merged.rounds.overall).toBe(4);
    const listed = keysOf(r.trades);
    expect(listed).toContain(cards.x);
    expect(listed).toContain(cards.z);
    expect(listed).not.toContain(cards.y);
    // The counts: one dropped version on the Overall list (dropped.dominated), still counted among the qualifying (each was a
    // card), as without the rule.
    expect(r.dropped?.dominated).toBe(1);
    expect(r.filter?.qualifying).toBe(plain.filter?.qualifying);
    // X's numbers are its own, as the search's state printed them.
    const st = searchStateOf(r) as SearchState;
    expect(st.shownByKey.get(cards.x)?.key).toBe(cards.x);
  });

  it("deterministic under the plan, and a re-filter there and back equals a fresh search, the version given back included", () => {
    const r = underPlan(cards, () => runTradeSearch(ctx, { settings: at(MIN) }));
    const again = underPlan(cards, () => runTradeSearch(buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 }), { settings: at(MIN) }));
    expect(again).toEqual(r);
    const there = underPlan(cards, () => runRefilter(ctx, searchStateOf(r) as SearchState, { minChance: 0 }));
    expect(there).toEqual(underPlan(cards, () => runTradeSearch(ctx, { settings: at(0) })));
    const back = underPlan(cards, () => runRefilter(ctx, searchStateOf(there) as SearchState, { minChance: MIN }));
    expect(back).toEqual(r);
  });
});
