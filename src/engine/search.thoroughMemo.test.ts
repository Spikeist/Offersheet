/**
 * A Thorough search's memory (Checkpoint 7h; search.ts, "Whole rosters", "Memory"; TradeSearchOptions.trimMemos): a
 * whole-roster search lets go of the scenario lineups its own exact evaluations and ladders memoize in the context's
 * optimizer (optimizer.ts trimScenarioMemo), every config.search.thorough.memoTrimEvery exact evaluations and once it's
 * done. Speed and memory only: the result, its re-filters, its cards' ladders ("How to offer it", kept and worked out again on
 * the context) and their later numbers ("now or after this week") are the ones a search that keeps them gives, bit for bit.
 * Synthetic league (smallLeague: made-up players, placeholder teams), with scenario lineups (the optimizer judges moves in
 * them only then).
 */
import { describe, expect, it } from "vitest";
import { config } from "./config";
import { buildTradeContext, laterNumbers, tradeInternals, type TradeContext } from "./evaluate";
import { offerLadderOfProposal, offerLadderOfSearch } from "./offers";
import { NO_STREAM } from "./optimizer";
import { runRefilter, runTradeSearch, searchStateOf } from "./search";
import { defaultTradeSettings, normalizeTradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { thoroughSettings } from "./thorough";
import { smallLeague } from "./trade.testing";
import type { TradeSearchResult } from "./tradeModel";

const league = smallLeague(11);
const contextOf = (): TradeContext => buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
const settings = normalizeTradeSettings(defaultTradeSettings());

describe("optimizer.trimScenarioMemo", () => {
  it("keeps the first rosters memoized, and a roster that's gone comes back the same", () => {
    const I = tradeInternals(contextOf());
    const opt = I.league.optimizer;
    expect(opt.judgesScenarios).toBe(true);
    const before = opt.scenarioMemoSize();
    const team = I.teams.find((t) => t.id !== I.me?.id) as (typeof I.teams)[number];
    const rosters = [0, 1, 2].map((k) => team.roster.filter((_, i) => i !== k));
    const values = rosters.map((r) => opt.scenarioValuesOf(r, NO_STREAM));
    expect(opt.scenarioMemoSize()).toBe(before + rosters.length);
    opt.trimScenarioMemo(before + 1);
    expect(opt.scenarioMemoSize()).toBe(before + 1);
    // The first one stays (the very object), the others are worked out again: equal, not the same objects.
    expect(opt.scenarioValuesOf(rosters[0] as string[], NO_STREAM)).toBe(values[0]);
    const again = opt.scenarioValuesOf(rosters[2] as string[], NO_STREAM);
    expect(again).not.toBe(values[2]);
    expect(again).toEqual(values[2]);
    opt.trimScenarioMemo(before);
    expect(opt.scenarioMemoSize()).toBe(before);
    opt.trimScenarioMemo(before + 10);
    expect(opt.scenarioMemoSize()).toBe(before);
  });
});

describe("a Thorough search lets go of its scenario lineups (trimMemos)", { timeout: 600_000 }, () => {
  const kept = contextOf();
  const trimmed = contextOf();
  const optKept = tradeInternals(kept).league.optimizer;
  const optTrimmed = tradeInternals(trimmed).league.optimizer;
  const mark = optTrimmed.scenarioMemoSize();
  const a: TradeSearchResult = runTradeSearch(kept, { settings, mode: "thorough", trimMemos: false });
  const b: TradeSearchResult = runTradeSearch(trimmed, { settings, mode: "thorough" });

  it("leaves the context's scenario memo as it was before the search; the switch off keeps what it memoized", () => {
    expect(b.trades.length).toBeGreaterThan(0);
    expect(optTrimmed.scenarioMemoSize()).toBe(mark);
    expect(optKept.scenarioMemoSize()).toBeGreaterThan(mark);
    expect(config.search.thorough.memoTrimEvery).toBeGreaterThanOrEqual(1);
  });

  it("gives the same result, re-filters and ladders as a search that keeps them", () => {
    expect(b).toEqual(a);
    for (const minChance of [0, 0.2, settings.minChance]) {
      const ra = runRefilter(kept, searchStateOf(a) as NonNullable<ReturnType<typeof searchStateOf>>, { minChance });
      const rb = runRefilter(trimmed, searchStateOf(b) as NonNullable<ReturnType<typeof searchStateOf>>, { minChance });
      expect(rb).toEqual(ra);
    }
    // Every card's ladder (the kept ones, and any worked out now on the trimmed context).
    for (const t of [...b.trades, ...(b.helpsBoth?.trades ?? [])]) expect(offerLadderOfSearch(b, t.key)).toEqual(offerLadderOfSearch(a, t.key));
    // The normal search on the trimmed context after it: the same as on the context that kept them.
    expect(runTradeSearch(trimmed, { settings })).toEqual(runTradeSearch(kept, { settings }));
  });

  it("gives the same ladders worked out from a card's trade, and the same later numbers", () => {
    const s3 = thoroughSettings(settings);
    for (const t of b.trades.slice(0, 3)) {
      const opts = { settings: s3, page: "finder" as const, ...(b.offerPrefer?.[t.key] ? { prefer: b.offerPrefer[t.key] } : {}), ...(b.offerOpen?.[t.key] ? { open: b.offerOpen[t.key] } : {}) };
      expect(offerLadderOfProposal(trimmed, t.proposal, opts)).toEqual(offerLadderOfProposal(kept, t.proposal, opts));
      const xa = searchStateOf(a)?.exactByKey.get(t.key);
      const xb = searchStateOf(b)?.exactByKey.get(t.key);
      if (!xa || !xb) continue;
      expect(laterNumbers(tradeInternals(trimmed), xb, s3)).toEqual(laterNumbers(tradeInternals(kept), xa, s3));
    }
  });
});
