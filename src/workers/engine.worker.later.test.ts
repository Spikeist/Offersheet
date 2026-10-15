/**
 * The engine worker's "now or after this week" replies (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.2;
 * engine.worker.ts's header, `later`), through its handler with fakes: once a search or re-filter answers with cards, each
 * card's numbers go out under that request's id, a slice at a time, in the cards' order, `done` with the last; a result without
 * cards gets none; a newer search pauses them and its own come first, then the older job resumes; a cancelled search lets it
 * resume; a new context drops the jobs of the results it forgets; a line that fails ends its job with the error's detail. The
 * real engine's numbers: engine.worker.later.engine.test.ts.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/engine/league", () => ({
  buildLeagueModel: () => {
    throw new Error("the tests pass their own builder");
  },
  buildLeagueModelWithContext: () => {
    throw new Error("the tests pass their own builder");
  },
  rateWaiverUpgrades: () => {
    throw new Error("the tests pass their own rating");
  },
}));
vi.mock("@/engine/evaluate", () => ({
  buildTradeContext: () => {
    throw new Error("the tests pass their own context builder");
  },
  analyzeTrade: () => {
    throw new Error("the tests pass their own Analyzer");
  },
  laterNumbers: () => {
    throw new Error("the tests pass their own lines");
  },
  tradeInternals: () => {
    throw new Error("Not a trade context built by buildTradeContext");
  },
  withWords: () => {
    throw new Error("the tests pass their own reword");
  },
}));
vi.mock("@/engine/search", () => ({
  tradeSearch: () => {
    throw new Error("the tests pass their own search");
  },
  searchStateOf: () => {
    throw new Error("the tests pass their own search state");
  },
  refilterSearch: () => {
    throw new Error("the tests pass their own re-filter");
  },
}));

import type { TradeContext } from "@/engine/evaluate";
import type { ModelInputs } from "@/engine/inputs";
import type { LeagueSnapshot } from "@/engine/model";
import { defaultTradeSettings, type TradeSettings } from "@/engine/settings";
import type { LaterNumbers, TradeEvaluation, TradeSearchProgress, TradeSearchResult } from "@/engine/tradeModel";
import { cardKeysOf, createEngineHandler, laterSourceOf, type EngineHandlerDeps, type EngineResponse, type LaterSource, type TradesRequest } from "./engine.worker";

const snapshot = {
  platform: "espn",
  leagueId: "4242",
  season: 2026,
  fetchedAt: "2026-10-01T15:00:00.000Z",
  currentWeek: 4,
  myTeamId: null,
  teams: [],
  settings: { tradeDeadline: null },
} as unknown as LeagueSnapshot;
const model = { version: 1, builtAt: "2026-10-01T15:01:00.000Z", nfl: { byeWeek: {}, kickoffs: {} } } as unknown as ModelInputs;
const settings: TradeSettings = defaultTradeSettings();
const NOW = "2026-10-01T16:00:00.000Z";
const trades = (id: number, extra: Partial<TradesRequest> = {}): TradesRequest => ({ type: "trades", id, snapshot, model, myTeamId: "3", nowIso: NOW, settings, partnerId: null, ...extra });

const card = (key: string) => ({ key }) as unknown as TradeEvaluation;
/** A finished search's result with these cards: the Overall list's, and the "Helps both" list's (one of them also on the first). */
function resultWith(overall: string[], both: string[] = []): TradeSearchResult {
  return {
    trades: overall.map(card),
    myTeamId: "3",
    baseline: { pPlayoffs: 0.6, pTitle: 0.1, expWins: 8 },
    hidden: { byBenefit: 0, byMarket: 0 },
    counts: { screened: 0, exact: 0, simScreen: 0, simFinal: 0 },
    timings: { total: 1 },
    notes: [],
    warnings: [],
    ...(both.length ? { helpsBoth: { trades: both.map(card), qualifying: both.length, byChance: 0, lowerWouldAdd: false, dropped: { partnerCap: 0, core: 0, filler: 0, givenPlayer: 0 } } } : {}),
  } as TradeSearchResult;
}

const numbers = (key: string): LaterNumbers => ({ b: key.length, tradeScore: 10 * key.length });

/**
 * A harness: the handler with a timer run by hand and a clock that moves `lineMs` per card's numbers (and 1 ms per other
 * read); searches answer, after two progress steps, with the cards `cardsOf(n)` gives the nth search (none by default);
 * the fake line source records each card made and fails at `failAt`.
 */
function harness(opts: { cardsOf?: (n: number) => { overall: string[]; both?: string[] }; lineMs?: number; sliceMs?: number; failAt?: string } = {}) {
  const posted: EngineResponse[] = [];
  const queue: (() => void)[] = [];
  let time = 0;
  const made: { id: number; key: string }[] = [];
  let searches = 0;
  /** Which search a result came from (the fake line source names its lines by it). */
  const searchOf = new Map<TradeSearchResult, number>();
  const buildContext = (() => ({ myTeamId: "3", partnerIds: [], notes: [], warnings: [], timings: {} }) as unknown as TradeContext) as NonNullable<EngineHandlerDeps["buildContext"]>;
  const search = (() => {
    const n = ++searches;
    return (function* (): Generator<TradeSearchProgress, TradeSearchResult, void> {
      yield { stage: "screening", done: 1, total: 2 };
      yield { stage: "exact", done: 2, total: 2 };
      const cards = opts.cardsOf?.(n) ?? { overall: [] };
      const result = resultWith(cards.overall, cards.both ?? []);
      searchOf.set(result, n);
      return result;
    })();
  }) as unknown as NonNullable<EngineHandlerDeps["search"]>;
  const laterSource = (result: TradeSearchResult): LaterSource | null => {
    const keys = cardKeysOf(result);
    const n = searchOf.get(result) ?? -1;
    return keys.length
      ? {
          keys,
          line: (key) => {
            made.push({ id: n, key });
            time += opts.lineMs ?? 50;
            if (key === opts.failAt) throw new RangeError(`no numbers for ${key}`);
            return numbers(key);
          },
        }
      : null;
  };
  const handle = createEngineHandler((r) => posted.push(r), {
    buildContext,
    search,
    laterSource,
    schedule: (fn) => void queue.push(fn),
    sliceMs: opts.sliceMs ?? 40,
    clock: () => (time += 1),
  });
  return {
    handle,
    posted,
    made,
    runNext: () => {
      const fn = queue.shift();
      fn?.();
      return !!fn;
    },
    runAll: () => {
      while (queue.length) queue.shift()?.();
    },
    later: (id: number) => posted.filter((r): r is Extract<EngineResponse, { type: "later" }> => r.type === "later" && r.id === id),
  };
}

/** A search run to its answer (its slices, without the line work that follows it). */
function answer(h: ReturnType<typeof harness>, id: number, extra: Partial<TradesRequest> = {}): void {
  h.handle(trades(id, extra));
  for (let i = 0; i < 20 && !h.posted.some((r) => r.type === "trades" && r.id === id); i++) h.runNext();
  expect(h.posted.some((r) => r.type === "trades" && r.id === id)).toBe(true);
}

describe("the worker's 'now or after this week' replies (Checkpoint 7e, item 4.2)", () => {
  it("after a search answers with cards, posts each card's numbers in order under its id, a slice at a time, done with the last", () => {
    const h = harness({ cardsOf: () => ({ overall: ["a", "b", "c"], both: ["b", "d"] }) });
    answer(h, 1);
    // Nothing made yet: the cards' numbers wait for the timer, after the answer.
    expect(h.made).toEqual([]);
    expect(h.later(1)).toEqual([]);
    h.runAll();
    const replies = h.later(1);
    // One card a slice (50 ms each over a 40 ms slice), the Overall list's in order, then the "Helps both" list's others.
    expect(replies.map((r) => r.result.map((l) => l.key))).toEqual([["a"], ["b"], ["c"], ["d"]]);
    expect(replies.map((r) => r.done)).toEqual([false, false, false, true]);
    expect(replies.flatMap((r) => r.result)).toEqual(["a", "b", "c", "d"].map((key) => ({ key, later: numbers(key) })));
    // Every one after the search's own answer.
    const answeredAt = h.posted.findIndex((r) => r.type === "trades" && r.id === 1);
    expect(h.posted.findIndex((r) => r.type === "later")).toBeGreaterThan(answeredAt);
  });

  it("fits several cards in a slice when they're quick", () => {
    const h = harness({ cardsOf: () => ({ overall: ["a", "b", "c", "d", "e"] }), lineMs: 15 });
    answer(h, 1);
    h.runAll();
    expect(h.later(1).map((r) => r.result.map((l) => l.key))).toEqual([["a", "b", "c"], ["d", "e"]]);
  });

  it("posts nothing for a result without cards", () => {
    const h = harness();
    answer(h, 1);
    h.runAll();
    expect(h.posted.some((r) => r.type === "later")).toBe(false);
  });

  it("pauses while a newer search runs: its cards' numbers come first once it answers, then the older job resumes", () => {
    const h = harness({ cardsOf: (n) => ({ overall: n === 1 ? ["a", "b", "c"] : ["x", "y"] }) });
    answer(h, 1);
    h.runNext(); // the first slice: card a
    expect(h.made.map((m) => m.key)).toEqual(["a"]);
    h.handle(trades(2));
    // The search runs; the slice of line work waiting in the queue finds it under way and does nothing.
    answer(h, 2);
    expect(h.made.map((m) => m.key)).toEqual(["a"]);
    h.runAll();
    expect(h.made.map((m) => `${m.id}:${m.key}`)).toEqual(["1:a", "2:x", "2:y", "1:b", "1:c"]);
    expect(h.later(2).at(-1)?.done).toBe(true);
    expect(h.later(1).flatMap((r) => r.result.map((l) => l.key))).toEqual(["a", "b", "c"]);
    expect(h.later(1).at(-1)?.done).toBe(true);
  });

  it("resumes the older job when the newer search is stopped", () => {
    const h = harness({ cardsOf: () => ({ overall: ["a", "b"] }) });
    answer(h, 1);
    h.runNext();
    h.handle(trades(2));
    h.handle({ type: "cancel", id: 2 });
    expect(h.posted.at(-1)).toEqual({ type: "cancelled", id: 2 });
    h.runAll();
    expect(h.later(1).flatMap((r) => r.result.map((l) => l.key))).toEqual(["a", "b"]);
    expect(h.later(1).at(-1)?.done).toBe(true);
    expect(h.later(2)).toEqual([]);
  });

  it("drops the jobs of results a new context forgets", () => {
    const h = harness({ cardsOf: (n) => ({ overall: n === 1 ? ["a", "b", "c"] : ["x"] }) });
    answer(h, 1);
    h.runNext(); // card a
    // Another setting the context reads (the positions I stream): a new context, and the old results go with the old one.
    answer(h, 2, { settings: { ...settings, streamPositions: ["K"] } });
    h.runAll();
    expect(h.made.map((m) => `${m.id}:${m.key}`)).toEqual(["1:a", "2:x"]);
    expect(h.later(1).map((r) => r.done)).toEqual([false]);
    expect(h.later(2).at(-1)?.done).toBe(true);
  });

  it("ends a job whose card's numbers fail: done, with the error's detail, the cards before it kept", () => {
    const h = harness({ cardsOf: () => ({ overall: ["a", "bad", "c"] }), failAt: "bad" });
    answer(h, 1);
    h.runAll();
    const replies = h.later(1);
    expect(replies.at(-1)).toEqual({ type: "later", id: 1, result: [], done: true, detail: "RangeError: no numbers for bad" });
    expect(replies.flatMap((r) => r.result.map((l) => l.key))).toEqual(["a"]);
    expect(h.made.map((m) => m.key)).toEqual(["a", "bad"]);
  });

  it("the default source: none for a result without cards; the cards' keys, each once, in the lists' order", () => {
    expect(laterSourceOf(resultWith([]))).toBeNull();
    expect(cardKeysOf(resultWith(["a", "b"], ["c", "a", "d"]))).toEqual(["a", "b", "c", "d"]);
  });
});
