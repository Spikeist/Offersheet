/**
 * The engine worker's message protocol (CLAUDE.md §3; Phase 4 wave 2 decision M12), tested through its handler:
 * no real Worker (Vitest runs in Node, where the module registers no listener). The League model builder, the
 * evaluation context, the search generator and the Analyzer are fakes, and the tests run the handler's timer and
 * clock themselves, so every slice of a search is seen: progress, the result, Stop, a newer search taking over,
 * and the cached evaluation context with its kickoff rule. The Analyzer's reply carries my odds before any trade from
 * the context it evaluated on (review of Phase 4; the real engine's are checked in engine.worker.engine.test.ts). Phase
 * 4c: a re-filter ranks a kept search's ideas again at another minimum chance, or stands in for it (the same result, or a
 * new search) when it can't.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/engine/league", () => ({
  buildLeagueModel: () => {
    throw new Error("the tests pass their own builder");
  },
}));
vi.mock("@/engine/evaluate", () => ({
  buildTradeContext: () => {
    throw new Error("the tests pass their own context builder");
  },
  analyzeTrade: () => {
    throw new Error("the tests pass their own Analyzer");
  },
  // As the engine's own does for a context it didn't build (the tests' fakes).
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

import type { TradeAnalysis, TradeContext } from "@/engine/evaluate";
import type { ModelInputs } from "@/engine/inputs";
import type { LeagueModel } from "@/engine/leagueModel";
import type { LeagueSnapshot } from "@/engine/model";
import { defaultTradeSettings, type TradeSettings } from "@/engine/settings";
import type { TradeEvaluation, TradeEvaluationCore, TradeProposal, TradeSearchProgress, TradeSearchResult } from "@/engine/tradeModel";
import {
  ENGINE_ERROR_MESSAGE,
  KEPT_RESULTS,
  SEARCH_SLICE_MS,
  contextBaseline,
  contextKey,
  contextStillValid,
  createEngineHandler,
  withoutSteps,
  type AnalyzeRequest,
  type BaselineOdds,
  type EngineHandlerDeps,
  type EngineResponse,
  type LeagueRequest,
  type RefilterRequest,
  type TradesRequest,
} from "./engine.worker";

/** Week 4's first kickoff (Thursday night) and the Sunday early games. */
const THURSDAY = "2026-10-02T00:15:00.000Z";
const SUNDAY = "2026-10-04T17:00:00.000Z";
/** Parker's deadline: Wed Dec 2 (week 13). */
const DEADLINE = "2026-12-02T17:00:00.000Z";

const snapshot = {
  platform: "espn",
  leagueId: "4242",
  season: 2026,
  fetchedAt: "2026-10-01T15:00:00.000Z",
  currentWeek: 4,
  myTeamId: null,
  teams: [],
  settings: { tradeDeadline: { week: 13, date: DEADLINE } },
} as unknown as LeagueSnapshot;
const model = { version: 1, builtAt: "2026-10-01T15:01:00.000Z", nfl: { byeWeek: {}, kickoffs: { 4: { KC: THURSDAY, BUF: SUNDAY } } } } as unknown as ModelInputs;
/** The user streams QB too (the playoff weight is no setting any more: the League model sets it, planner reply to Checkpoint 7a, §6.1). */
const settings: TradeSettings = { ...defaultTradeSettings(), streamPositions: ["K", "DEF", "QB"] };
const NOW = "2026-10-01T16:00:00.000Z";
const withoutSettings: Omit<LeagueRequest, "settings"> = { type: "league", id: 7, snapshot, model, myTeamId: "3", nowIso: "2026-09-30T02:00:00.000Z" };
const request: LeagueRequest = { ...withoutSettings, settings };
const RESULT = { weeks: [4, 5] } as unknown as LeagueModel;

const trades = (id: number, extra: Partial<TradesRequest> = {}): TradesRequest => ({ type: "trades", id, snapshot, model, myTeamId: "3", nowIso: NOW, settings, partnerId: null, ...extra });
/** A re-filter of the search `of` at minimum chance `minChance` (Phase 4c). */
const refilterReq = (id: number, of: number, minChance: number, extra: Partial<RefilterRequest> = {}): RefilterRequest => ({
  type: "refilter",
  id,
  of,
  snapshot,
  model,
  myTeamId: "3",
  nowIso: NOW,
  settings: { ...settings, minChance },
  partnerId: null,
  ...extra,
});
const proposal: TradeProposal = { partnerId: "5", give: [{ kind: "player", id: "101" }], get: [{ kind: "player", id: "202" }] };
const analyzeReq = (id: number, extra: Partial<AnalyzeRequest> = {}): AnalyzeRequest => ({ type: "analyze", id, snapshot, model, myTeamId: "3", nowIso: NOW, settings, proposal, ...extra });

type Build = NonNullable<EngineHandlerDeps["build"]>;
type BuildContext = NonNullable<EngineHandlerDeps["buildContext"]>;
type Search = NonNullable<EngineHandlerDeps["search"]>;
type Analyze = NonNullable<EngineHandlerDeps["analyze"]>;
type Refilter = NonNullable<EngineHandlerDeps["refilter"]>;
type StateOf = NonNullable<EngineHandlerDeps["searchState"]>;

/** A fake search state (search.ts SearchState): the result it belongs to and the context it ran on. */
interface FakeState {
  result: TradeSearchResult;
  ctx: TradeContext;
}

const SEARCH_RESULT = {
  trades: [],
  myTeamId: "3",
  baseline: { pPlayoffs: 0.6, pTitle: 0.1, expWins: 8 },
  hidden: { byBenefit: 0, byMarket: 0 },
  counts: { screened: 0, exact: 0, simScreen: 0, simFinal: 0 },
  timings: { screening: 2000, total: 4210 },
  notes: [],
  warnings: [],
} as TradeSearchResult;
const ANALYSIS: TradeAnalysis = { evaluation: null, illegal: "You can't trade a player twice.", notes: [] };
/** My odds before any trade, as the fake contexts report them. */
const BASELINE: BaselineOdds = { pPlayoffs: 0.71, pTitle: 0.15, expWins: 8.4 };
/** The Analyzer's reply with the fake contexts' odds. */
const ANALYZED = { ...ANALYSIS, baseline: BASELINE };

/**
 * A harness: the handler with a timer the test runs by hand and a clock that moves `tick` ms per read, a
 * context builder that counts its builds, a search that yields `steps` progress steps, and an Analyzer. Re-filtering
 * (Phase 4c): every result the fake search returns has a state (none with `noState`: a search that stopped before
 * ranking), and the fake re-filter refuses a state of another context (or every state, `refilterThrows`), as
 * search.ts refilterSearch does at its first step, else yields 3 steps under "rank" and returns the result at the new
 * minimum.
 */
function harness(
  opts: { steps?: number; tick?: number; sliceMs?: number; withClock?: boolean; failContext?: () => boolean; failSearchAt?: number; noState?: boolean; refilterThrows?: boolean } = {},
) {
  const posted: EngineResponse[] = [];
  const queue: (() => void)[] = [];
  let time = 0;
  const tick = opts.tick ?? 10;
  const contexts: { snapshot: LeagueSnapshot; inputs: ModelInputs; opts: Parameters<BuildContext>[2] }[] = [];
  const searches: { ctx: TradeContext; opts: Parameters<Search>[1] }[] = [];
  const analyses: Parameters<Analyze>[] = [];
  const refilters: { ctx: TradeContext; state: FakeState; opts: Parameters<Refilter>[2] }[] = [];
  const states = new Map<TradeSearchResult, FakeState>();
  /** The contexts the Analyzer's odds before any trade were read from. */
  const baselines: TradeContext[] = [];
  /** How many units of search work ran (each `next()` call of a search generator). */
  let advanced = 0;
  const buildContext = ((snap, inputs, o) => {
    if (opts.failContext?.()) throw new TypeError("context failed");
    contexts.push({ snapshot: snap, inputs, opts: o });
    return { myTeamId: snap.myTeamId, partnerIds: [], notes: [], warnings: [], timings: {}, n: contexts.length } as unknown as TradeContext;
  }) as BuildContext;
  const steps = opts.steps ?? 10;
  const run = function* (ctx: TradeContext): Generator<TradeSearchProgress, TradeSearchResult, void> {
    for (let i = 0; i < steps; i++) {
      advanced++;
      if (opts.failSearchAt === i) throw new RangeError("no partner 9");
      yield { stage: i < steps / 2 ? "screening" : "exact", done: i + 1, total: steps };
    }
    advanced++;
    const result: TradeSearchResult = { ...SEARCH_RESULT, notes: [`search ${searches.length}`] };
    if (!opts.noState) states.set(result, { result, ctx });
    return result;
  };
  // Calls are recorded when the search is made (a generator's body only runs at its first step).
  const search = ((ctx: TradeContext, o: Parameters<Search>[1]) => {
    searches.push({ ctx, opts: o });
    return run(ctx);
  }) as Search;
  const searchState = ((r: TradeSearchResult) => states.get(r) ?? null) as unknown as StateOf;
  const refilter = ((ctx: TradeContext, state: FakeState, o: Parameters<Refilter>[2]) => {
    refilters.push({ ctx, state, opts: o });
    return (function* (): Generator<TradeSearchProgress, TradeSearchResult, void> {
      if (opts.refilterThrows || state.ctx !== ctx) throw new Error("This search state belongs to another trade context");
      for (let i = 0; i < 3; i++) {
        advanced++;
        yield { stage: "rank", done: i, total: 3 };
      }
      const result: TradeSearchResult = { ...state.result, notes: [...state.result.notes, `re-filtered at ${o.minChance}`], filter: { minChance: o.minChance, qualifying: 2, few: false }, timings: { rank: 1, steps: 2, total: 3 } };
      states.set(result, { result, ctx });
      return result;
    })();
  }) as unknown as Refilter;
  const analyze = ((...args: Parameters<Analyze>) => {
    analyses.push(args);
    return ANALYSIS;
  }) as Analyze;
  const deps: EngineHandlerDeps = {
    buildContext,
    search,
    analyze,
    searchState,
    refilter,
    baseline: (ctx) => {
      baselines.push(ctx);
      return BASELINE;
    },
    schedule: (fn) => void queue.push(fn),
    sliceMs: opts.sliceMs ?? 40,
    ...(opts.withClock === false ? {} : { clock: () => (time += tick) }),
  };
  const handle = createEngineHandler((r) => posted.push(r), deps);
  return {
    handle,
    posted,
    contexts,
    searches,
    refilters,
    analyses,
    baselines,
    get advanced() {
      return advanced;
    },
    /** Runs the next timer callback; false when none is waiting. */
    runNext(): boolean {
      const fn = queue.shift();
      if (!fn) return false;
      fn();
      return true;
    },
    runAll(): void {
      while (queue.length) queue.shift()?.();
    },
    waiting: () => queue.length,
  };
}

describe("the League model request (§3: the engine runs in a Web Worker)", () => {
  const run = (message: unknown, deps: EngineHandlerDeps) => {
    const posted: EngineResponse[] = [];
    createEngineHandler((r) => posted.push(r), deps)(message);
    return posted;
  };

  it("builds the League model with the user's team and the request's time, and echoes the id", () => {
    const calls: Parameters<Build>[] = [];
    const build = ((...args: Parameters<Build>) => {
      calls.push(args);
      return RESULT;
    }) as Build;
    const clock = () => 12.5;
    expect(run(request, { build, clock })).toEqual([{ type: "league", id: 7, result: RESULT }]);
    const [snap, inputs, opts] = calls[0] ?? [];
    expect(snap).toEqual({ ...snapshot, myTeamId: "3" });
    expect(snapshot.myTeamId).toBeNull(); // the caller's snapshot isn't changed
    expect(inputs).toBe(model);
    expect(opts?.now.toISOString()).toBe("2026-09-30T02:00:00.000Z");
    expect(opts?.clock).toBe(clock);
    expect(opts?.settings).toEqual(settings);
  });

  it("passes the league's settings to the builder, normalized (Phase 4 L12: the positions I stream, the playoff weight)", () => {
    const seen: (TradeSettings | undefined)[] = [];
    const build = ((_s: unknown, _m: unknown, opts: Parameters<Build>[2]) => {
      seen.push(opts.settings);
      return RESULT;
    }) as unknown as Build;
    // A copy from an older version (no streamPositions), with an out-of-range weight and a stray field.
    run({ ...request, settings: { version: 1, playoffWeight: 9, maxPerSide: 3, junk: true } }, { build });
    expect(seen[0]).toEqual({ ...defaultTradeSettings(), maxPerSide: 3 });
    // No settings at all (or not an object): the defaults, never an error.
    for (const bad of [undefined, null, "K,DEF", 42]) {
      expect(run(bad === undefined ? withoutSettings : { ...withoutSettings, settings: bad }, { build })).toEqual([{ type: "league", id: 7, result: RESULT }]);
      expect(seen.at(-1)).toEqual(defaultTradeSettings());
    }
  });

  it("passes no clock when none is given", () => {
    let seen: Parameters<Build>[2] | undefined;
    const build = ((_s: unknown, _m: unknown, opts: Parameters<Build>[2]) => {
      seen = opts;
      return RESULT;
    }) as unknown as Build;
    run({ ...request, myTeamId: null }, { build });
    expect(seen && "clock" in seen).toBe(false);
  });

  it("turns an engine failure into an error reply with the same id", () => {
    const build = (() => {
      throw new RangeError("week 99 out of range");
    }) as Build;
    expect(run(request, { build })).toEqual([{ type: "error", id: 7, message: ENGINE_ERROR_MESSAGE, detail: "RangeError: week 99 out of range" }]);
  });

  it("answers anything that isn't a request with an error, never a throw", () => {
    const build = (() => RESULT) as Build;
    expect(run(undefined, { build })).toMatchObject([{ type: "error", id: -1 }]);
    expect(run("league", { build })).toMatchObject([{ type: "error", id: -1 }]);
    expect(run({ ...request, type: "draft" }, { build })).toMatchObject([{ type: "error", id: 7 }]);
    expect(run({ ...request, snapshot: null }, { build })).toMatchObject([{ type: "error", id: 7 }]);
    expect(run({ ...request, myTeamId: 3 }, { build })).toMatchObject([{ type: "error", id: 7 }]);
    expect(run({ ...request, nowIso: "yesterday" }, { build })).toMatchObject([{ type: "error", id: 7, message: ENGINE_ERROR_MESSAGE }]);
  });
});

describe("the trade search request (M12: time slices, progress, Stop)", () => {
  it("says it has started at once, then builds the context and runs the search a slice at a time, ~40 ms of work each, posting the latest progress per slice", () => {
    const h = harness({ steps: 10, tick: 10, sliceMs: 40 });
    h.handle(trades(1));
    // Nothing heavy yet: the setup step is announced and the work waits for the timer.
    expect(h.posted).toEqual([{ type: "progress", id: 1, progress: { stage: "setup", done: 0, total: 1 } }]);
    expect(h.contexts).toHaveLength(0);
    // First run: the context, then a slice boundary before the search starts.
    h.runNext();
    expect(h.contexts).toHaveLength(1);
    expect(h.contexts[0]?.snapshot).toEqual({ ...snapshot, myTeamId: "3" });
    expect(h.contexts[0]?.inputs).toBe(model);
    expect(h.contexts[0]?.opts.now.toISOString()).toBe(NOW);
    expect(h.contexts[0]?.opts.settings).toEqual(settings);
    expect(typeof h.contexts[0]?.opts.clock).toBe("function");
    expect(h.searches[0]?.opts).toMatchObject({ settings, partnerId: null });
    expect(h.advanced).toBe(0);
    // Each slice reads the clock once at its start and once per unit: 4 units make 40 ms.
    h.runNext();
    expect(h.advanced).toBe(4);
    expect(h.posted.at(-1)).toEqual({ type: "progress", id: 1, progress: { stage: "screening", done: 4, total: 10 } });
    h.runAll();
    // One progress message per slice (its latest step), and the result straight from the slice that finishes.
    expect(h.posted.slice(1).map((r) => (r.type === "progress" ? `${r.progress.stage} ${r.progress.done}` : r.type))).toEqual(["screening 4", "exact 8", "trades"]);
    expect(h.posted.at(-1)).toEqual({ type: "trades", id: 1, result: { ...SEARCH_RESULT, notes: ["search 1"] } });
    expect(h.waiting()).toBe(0);
  });

  it("searches one partner when asked, and every other team when partnerId is missing (an older page)", () => {
    const h = harness();
    h.handle(trades(1, { partnerId: "5" }));
    h.runAll();
    const { partnerId: _, ...noPartner } = trades(2);
    void _;
    h.handle(noPartner);
    h.runAll();
    expect(h.searches.map((s) => s.opts?.partnerId)).toEqual(["5", null]);
  });

  it("stops at the next slice when cancelled: a 'cancelled' reply, and no more work or replies for it", () => {
    const h = harness({ steps: 20 });
    h.handle(trades(1));
    h.runNext(); // context
    h.runNext(); // first slice
    const done = h.advanced;
    h.handle({ type: "cancel", id: 1 });
    expect(h.posted.at(-1)).toEqual({ type: "cancelled", id: 1 });
    const replies = h.posted.length;
    h.runAll();
    expect(h.advanced).toBe(done);
    expect(h.posted).toHaveLength(replies);
  });

  it("never builds the context for a search stopped before it began", () => {
    const h = harness();
    h.handle(trades(1));
    h.handle({ type: "cancel", id: 1 });
    h.runAll();
    expect(h.contexts).toHaveLength(0);
    expect(h.posted.map((r) => r.type)).toEqual(["progress", "cancelled"]);
  });

  it("lets a newer search take over: the older one is cancelled and stops, and the cached context is reused", () => {
    const h = harness({ steps: 20 });
    h.handle(trades(1));
    h.runNext();
    h.runNext();
    const before = h.advanced;
    h.handle(trades(2, { settings: { ...settings, maxPerSide: 3, lambda: 0.4 } }));
    expect(h.posted.filter((r) => r.id === 1).at(-1)).toEqual({ type: "cancelled", id: 1 });
    h.runAll();
    // Only the new search ran after that, on the same context (the search's own settings aren't part of its key).
    expect(h.advanced - before).toBe(21);
    expect(h.contexts).toHaveLength(1);
    expect(h.searches[1]?.ctx).toBe(h.searches[0]?.ctx);
    expect(h.searches[1]?.opts?.settings).toMatchObject({ maxPerSide: 3, lambda: 0.4 });
    expect(h.posted.filter((r) => r.type === "trades").map((r) => r.id)).toEqual([2]);
  });

  it("ignores a cancel for another id, or for a search that has finished", () => {
    const h = harness({ steps: 2 });
    h.handle(trades(1));
    h.handle({ type: "cancel", id: 99 });
    h.runAll();
    h.handle({ type: "cancel", id: 1 });
    expect(h.posted.map((r) => r.type)).toEqual(["progress", "trades"]);
  });

  it("turns a failing search or context into an error reply for that search, and the next search still runs", () => {
    const h = harness({ steps: 6, failSearchAt: 3 });
    h.handle(trades(1));
    h.runAll();
    expect(h.posted.at(-1)).toEqual({ type: "error", id: 1, message: ENGINE_ERROR_MESSAGE, detail: "RangeError: no partner 9" });
    let fail = true;
    const g = harness({ failContext: () => fail });
    g.handle(trades(4));
    g.runAll();
    expect(g.posted.at(-1)).toEqual({ type: "error", id: 4, message: ENGINE_ERROR_MESSAGE, detail: "TypeError: context failed" });
    fail = false;
    g.handle(trades(5));
    g.runAll();
    expect(g.posted.at(-1)).toMatchObject({ type: "trades", id: 5 });
  });

  it("passes no clock to the engine when none is given (the slices still have one)", () => {
    const h = harness({ withClock: false, steps: 3 });
    h.handle(trades(1));
    h.runAll();
    expect(h.contexts[0] && "clock" in h.contexts[0].opts).toBe(false);
    expect(h.searches[0]?.opts && "clock" in h.searches[0].opts).toBe(false);
    expect(h.posted.at(-1)).toMatchObject({ type: "trades", id: 1 });
  });

  it("rejects a search request without its fields, and a cancel needs a numeric id", () => {
    const h = harness();
    h.handle({ ...trades(3), partnerId: 5 });
    h.handle({ ...trades(4), snapshot: undefined });
    h.handle({ type: "cancel", id: "3" });
    expect(h.posted).toEqual([
      { type: "error", id: 3, message: ENGINE_ERROR_MESSAGE, detail: "Not an engine request." },
      { type: "error", id: 4, message: ENGINE_ERROR_MESSAGE, detail: "Not an engine request." },
      { type: "error", id: -1, message: ENGINE_ERROR_MESSAGE, detail: "Not an engine request." },
    ]);
  });

  it("slices about SEARCH_SLICE_MS of work by default (M12: 30–50 ms between looks at the messages)", () => {
    expect(SEARCH_SLICE_MS).toBeGreaterThanOrEqual(30);
    expect(SEARCH_SLICE_MS).toBeLessThanOrEqual(50);
  });
});

describe("the re-filter request (Phase 4c; planner reply to Checkpoint 4b, change 10: re-filter instantly, no new search)", () => {
  /** The replies to request `id`, in words: "rank 1" for progress, the type otherwise. */
  const repliesTo = (h: ReturnType<typeof harness>, id: number) => h.posted.filter((r) => r.id === id).map((r) => (r.type === "progress" ? `${r.progress.stage} ${r.progress.done}` : r.type));
  const resultOf = (h: ReturnType<typeof harness>, id: number) => {
    const r = h.posted.find((x) => x.id === id && x.type === "trades");
    return r?.type === "trades" ? r.result : null;
  };

  it("ranks a finished search's ideas again at the request's minimum, in slices under 'rank', on the same context, with no new search", () => {
    const h = harness();
    h.handle(trades(1));
    h.runAll();
    h.handle(refilterReq(2, 1, 0.3));
    h.runAll();
    expect(h.searches).toHaveLength(1);
    expect(h.contexts).toHaveLength(1);
    expect(h.refilters).toHaveLength(1);
    expect(h.refilters[0]?.ctx).toBe(h.searches[0]?.ctx);
    expect(h.refilters[0]?.state.result).toBe(resultOf(h, 1));
    expect(h.refilters[0]?.opts).toMatchObject({ minChance: 0.3 });
    expect(typeof h.refilters[0]?.opts.clock).toBe("function");
    // Its progress is the ranking's alone, from the first reply on (its 3 steps fit in one slice).
    expect(repliesTo(h, 2)).toEqual(["rank 0", "trades"]);
    // A slower clock: progress per slice, every step under "rank".
    const slow = harness({ tick: 30 });
    slow.handle(trades(1));
    slow.runAll();
    slow.handle(refilterReq(2, 1, 0.3));
    slow.runAll();
    expect(repliesTo(slow, 2)).toEqual(["rank 0", "rank 1", "trades"]);
    expect(resultOf(h, 2)).toMatchObject({ notes: ["search 1", "re-filtered at 0.3"], filter: { minChance: 0.3 } });
  });

  it("answers with the search's own timings, the re-filter's time apart, also when re-filtering a re-filtered result", () => {
    const h = harness();
    h.handle(trades(1));
    h.runAll();
    h.handle(refilterReq(2, 1, 0.3));
    h.runAll();
    expect(resultOf(h, 2)?.timings).toEqual({ screening: 2000, total: 4210, refilter: 3 });
    h.handle(refilterReq(3, 2, 0.5));
    h.runAll();
    expect(h.searches).toHaveLength(1);
    expect(resultOf(h, 3)).toMatchObject({ notes: ["search 1", "re-filtered at 0.3", "re-filtered at 0.5"], filter: { minChance: 0.5 }, timings: { screening: 2000, total: 4210, refilter: 3 } });
  });

  it("answers with the same result when the search stopped before ranking (no state: it holds for any minimum)", () => {
    const h = harness({ noState: true });
    h.handle(trades(1));
    h.runAll();
    h.handle(refilterReq(2, 1, 0.3));
    h.runAll();
    expect(h.searches).toHaveLength(1);
    expect(h.refilters).toHaveLength(0);
    expect(resultOf(h, 2)).toBe(resultOf(h, 1));
  });

  it("searches afresh, with the request's settings, when it holds no such result", () => {
    const h = harness({ steps: 4 });
    h.handle(refilterReq(1, -1, 0.3, { partnerId: "5" }));
    h.runAll();
    expect(h.searches).toHaveLength(1);
    expect(h.searches[0]?.opts).toMatchObject({ settings: { minChance: 0.3 }, partnerId: "5" });
    expect(repliesTo(h, 1).at(-1)).toBe("trades");
    // Its result is kept like a search's: it can be re-filtered in turn.
    h.handle(refilterReq(2, 1, 0.5));
    h.runAll();
    expect(h.searches).toHaveLength(1);
    expect(h.refilters).toHaveLength(1);
  });

  it("searches afresh after a kickoff (a new context: the results it kept are forgotten), and when the engine refuses the state", () => {
    const h = harness();
    h.handle(trades(1));
    h.runAll();
    h.handle(refilterReq(2, 1, 0.3, { nowIso: THURSDAY }));
    h.runAll();
    expect(h.contexts).toHaveLength(2);
    expect(h.refilters).toHaveLength(0);
    expect(h.searches).toHaveLength(2);
    expect(h.searches[1]?.opts?.settings).toMatchObject({ minChance: 0.3 });
    const refused = harness({ refilterThrows: true });
    refused.handle(trades(1));
    refused.runAll();
    refused.handle(refilterReq(2, 1, 0.3));
    refused.runAll();
    expect(refused.refilters).toHaveLength(1);
    expect(refused.searches).toHaveLength(2);
    expect(resultOf(refused, 2)).toMatchObject({ notes: ["search 2"] });
  });

  it(`keeps the last ${KEPT_RESULTS} results: an older one is searched afresh`, () => {
    const h = harness({ steps: 2 });
    for (let id = 1; id <= KEPT_RESULTS + 1; id++) {
      h.handle(trades(id));
      h.runAll();
    }
    h.handle(refilterReq(10, 1, 0.3));
    h.runAll();
    expect(h.searches).toHaveLength(KEPT_RESULTS + 2);
    h.handle(refilterReq(11, KEPT_RESULTS + 1, 0.3));
    h.runAll();
    expect(h.searches).toHaveLength(KEPT_RESULTS + 2);
    expect(h.refilters).toHaveLength(1);
  });

  it("is one at a time with searches: Stop and a newer search stop it, and it stops a search under way", () => {
    const h = harness();
    h.handle(trades(1));
    h.runAll();
    h.handle(refilterReq(2, 1, 0.3));
    h.runNext(); // the generator, with its first step taken
    h.handle({ type: "cancel", id: 2 });
    expect(h.posted.at(-1)).toEqual({ type: "cancelled", id: 2 });
    h.runAll();
    expect(repliesTo(h, 2)).toEqual(["rank 0", "cancelled"]);
    h.handle(refilterReq(3, 1, 0.3));
    h.handle(trades(4));
    h.runAll();
    expect(repliesTo(h, 3)).toEqual(["rank 0", "cancelled"]);
    expect(repliesTo(h, 4).at(-1)).toBe("trades");
    h.handle(trades(5));
    h.runNext();
    h.handle(refilterReq(6, 4, 0.2));
    expect(h.posted.filter((r) => r.id === 5).at(-1)).toEqual({ type: "cancelled", id: 5 });
  });

  it("rejects a re-filter request without a numeric search id", () => {
    const h = harness();
    h.handle({ ...refilterReq(3, 1, 0.3), of: "1" });
    h.handle({ ...refilterReq(4, 1, 0.3), partnerId: 5 });
    expect(h.posted).toEqual([
      { type: "error", id: 3, message: ENGINE_ERROR_MESSAGE, detail: "Not an engine request." },
      { type: "error", id: 4, message: ENGINE_ERROR_MESSAGE, detail: "Not an engine request." },
    ]);
  });
});

describe("the Trade Analyzer request", () => {
  it("evaluates the proposal on the context with the request's settings, and replies with the analysis and my odds before any trade", () => {
    const h = harness();
    h.handle(analyzeReq(9));
    expect(h.posted).toEqual([{ type: "analysis", id: 9, result: ANALYZED }]);
    const [ctx, p, o] = h.analyses[0] ?? [];
    expect(ctx).toMatchObject({ myTeamId: "3" });
    expect(p).toEqual(proposal);
    expect(o?.settings).toEqual(settings);
    expect(typeof o?.clock).toBe("function");
    // The odds come from the very context the trade was evaluated on (review of Phase 4: the card's end percents).
    expect(h.baselines).toEqual([ctx]);
  });

  it("sends no odds before any trade for a context the engine didn't build (contextBaseline's default)", () => {
    const posted: EngineResponse[] = [];
    const handle = createEngineHandler((r) => posted.push(r), {
      buildContext: (() => ({ myTeamId: "3" })) as unknown as BuildContext,
      analyze: (() => ANALYSIS) as Analyze,
    });
    handle(analyzeReq(5));
    expect(posted).toEqual([{ type: "analysis", id: 5, result: { ...ANALYSIS, baseline: null } }]);
    expect(contextBaseline({ myTeamId: "3" } as unknown as TradeContext)).toBeNull();
  });

  it("checks the proposal's shape: a partner and two lists of players or picks", () => {
    const h = harness();
    for (const bad of [null, { partnerId: 5, give: [], get: [] }, { partnerId: "5", give: [{ kind: "player" }], get: [] }, { partnerId: "5", give: [], get: "202" }]) h.handle({ ...analyzeReq(2), proposal: bad });
    expect(h.posted.map((r) => [r.type, r.id])).toEqual(Array.from({ length: 4 }, () => ["error", 2]));
    h.handle(analyzeReq(3, { proposal: { partnerId: "5", give: [{ kind: "pick", season: 2027, round: 1, originalTeamId: "3" }], get: [] } }));
    expect(h.posted.at(-1)).toMatchObject({ type: "analysis", id: 3 });
  });

  it("turns an Analyzer failure into an error reply", () => {
    const posted: EngineResponse[] = [];
    const handle = createEngineHandler((r) => posted.push(r), {
      buildContext: (() => ({})) as unknown as BuildContext,
      analyze: (() => {
        throw new Error("boom");
      }) as Analyze,
    });
    handle(analyzeReq(4));
    expect(posted).toEqual([{ type: "error", id: 4, message: ENGINE_ERROR_MESSAGE, detail: "Error: boom" }]);
  });

  describe("a trade opened from 'If they say no, try:' (steps: false; review of Phase 4b)", () => {
    // A stepped evaluation: its pitch proposes the smaller first offer.
    const stepped = {
      key: "5|give:101,102|get:202",
      proposal: { partnerId: "5", give: [{ kind: "player", id: "101" }, { kind: "player", id: "102" }], get: [{ kind: "player", id: "202" }] },
      b: 2.5,
      pAccept: 0.4,
      steps: { offerFirst: { key: "5|give:101|get:202" }, ifNo: { add: "102" }, ranked: "full" },
      reasons: ["the ranked trade's reasons"],
      pitch: "Hey! Would you trade 202 for 101?",
    } as unknown as TradeEvaluation;
    const reworded: TradeEvaluationCore[] = [];
    const reword = (_ctx: TradeContext, core: TradeEvaluationCore): TradeEvaluation => {
      reworded.push(core);
      return { ...core, reasons: ["the ranked trade's reasons"], pitch: "Hey! Would you trade 202 for 101 and 102?" } as TradeEvaluation;
    };
    const handlerWith = (analysis: TradeAnalysis) => {
      const posted: EngineResponse[] = [];
      const handle = createEngineHandler((r) => posted.push(r), {
        buildContext: (() => ({ myTeamId: "3" })) as unknown as BuildContext,
        analyze: (() => analysis) as Analyze,
        baseline: () => BASELINE,
        reword,
      });
      return { handle, posted };
    };

    it("drops the steps and makes the words again without them, keeping the numbers", () => {
      reworded.length = 0;
      const h = handlerWith({ evaluation: stepped, illegal: null, notes: ["a note"] });
      h.handle(analyzeReq(6, { steps: false }));
      const reply = h.posted[0];
      expect(reply).toMatchObject({ type: "analysis", id: 6, result: { illegal: null, notes: ["a note"], baseline: BASELINE } });
      const e = reply?.type === "analysis" ? reply.result.evaluation : null;
      expect(e?.steps).toBeUndefined();
      expect(e?.pitch).toBe("Hey! Would you trade 202 for 101 and 102?");
      expect([e?.key, e?.b, e?.pAccept]).toEqual([stepped.key, 2.5, 0.4]);
      // The core it was worded from: no steps, no old words.
      expect(reworded).toHaveLength(1);
      expect(Object.keys(reworded[0] ?? {}).sort()).toEqual(["b", "key", "pAccept", "proposal"]);
    });

    it("leaves an evaluation as it is otherwise: steps wanted, none to drop, or nothing evaluated", () => {
      reworded.length = 0;
      for (const extra of [{}, { steps: true }]) {
        const h = handlerWith({ evaluation: stepped, illegal: null, notes: [] });
        h.handle(analyzeReq(7, extra));
        expect(h.posted[0]?.type === "analysis" ? h.posted[0].result.evaluation : null).toBe(stepped);
      }
      const plain = { ...stepped, steps: undefined } as TradeEvaluation;
      const h = handlerWith({ evaluation: plain, illegal: null, notes: [] });
      h.handle(analyzeReq(8, { steps: false }));
      expect(h.posted[0]?.type === "analysis" ? h.posted[0].result.evaluation : null).toBe(plain);
      expect(withoutSteps({} as TradeContext, ANALYSIS, reword)).toBe(ANALYSIS);
      expect(reworded).toHaveLength(0);
    });
  });

  it("answers while a search runs, without stopping it", () => {
    const h = harness({ steps: 12 });
    h.handle(trades(1));
    h.runNext();
    h.runNext();
    h.handle(analyzeReq(2));
    expect(h.posted.at(-1)).toEqual({ type: "analysis", id: 2, result: ANALYZED });
    h.runAll();
    expect(h.posted.at(-1)).toMatchObject({ type: "trades", id: 1 });
    expect(h.contexts).toHaveLength(1);
  });
});

describe("the cached evaluation context (M12)", () => {
  it("is reused for the same league, league data, inputs, team and the settings the context reads", () => {
    const h = harness();
    h.handle(analyzeReq(1));
    h.handle(analyzeReq(2, { settings: { ...settings, lambda: 0.8, maxPerSide: 3, mustInclude: ["202"], targetPositions: ["RB"], avoidPositions: ["TE"], includeKDefIdp: true, includePicks: true } }));
    // The same settings the context reads, in another order: the same context.
    h.handle(analyzeReq(3, { settings: { ...settings, streamPositions: ["QB", "DEF", "K"] } }));
    expect(h.contexts).toHaveLength(1);
    expect(new Set(h.analyses.map((a) => a[0])).size).toBe(1);
  });

  it("is built again for another team, league data, inputs build, league, or a setting the context reads", () => {
    const changes: Partial<AnalyzeRequest>[] = [
      { myTeamId: "4" },
      { snapshot: { ...snapshot, fetchedAt: "2026-10-01T15:05:00.000Z" } },
      { model: { ...model, builtAt: "2026-10-01T15:06:00.000Z" } },
      { snapshot: { ...snapshot, leagueId: "5151" } },
      // The goal: the context's automatic playoff weight reads it (league.ts step 5c).
      { settings: { ...settings, goal: "playoffs" } },
      { settings: { ...settings, streamPositions: ["K"] } },
    ];
    for (const change of changes) {
      const h = harness();
      h.handle(analyzeReq(1));
      h.handle(analyzeReq(2, change));
      expect(h.contexts, JSON.stringify(change)).toHaveLength(2);
    }
  });

  it("is reused while no game kicks off between its time and the request's, and built again once one does", () => {
    const at = (iso: string) => {
      const h = harness();
      h.handle(analyzeReq(1, { nowIso: "2026-10-01T16:00:00.000Z" }));
      h.handle(analyzeReq(2, { nowIso: iso }));
      return h.contexts.length;
    };
    expect(at("2026-10-01T23:59:00.000Z")).toBe(1); // later the same day, before Thursday's kickoff
    expect(at(THURSDAY)).toBe(2); // at kickoff the game has started
    expect(at("2026-10-03T12:00:00.000Z")).toBe(2);
    expect(at("2026-09-30T12:00:00.000Z")).toBe(1); // earlier, no kickoff between
    // The context's new time is the one it was built for: Friday's request rebuilt it, so Saturday's reuses it.
    const h = harness();
    h.handle(analyzeReq(1, { nowIso: "2026-10-01T16:00:00.000Z" }));
    h.handle(analyzeReq(2, { nowIso: "2026-10-02T12:00:00.000Z" }));
    h.handle(analyzeReq(3, { nowIso: "2026-10-03T12:00:00.000Z" }));
    expect(h.contexts.map((c) => c.opts.now.toISOString())).toEqual(["2026-10-01T16:00:00.000Z", "2026-10-02T12:00:00.000Z"]);
  });

  it("is never kept when its build fails", () => {
    let fail = true;
    const h = harness({ failContext: () => fail });
    h.handle(analyzeReq(1));
    fail = false;
    h.handle(analyzeReq(2));
    h.handle(analyzeReq(3));
    expect(h.posted.map((r) => r.type)).toEqual(["error", "analysis", "analysis"]);
    expect(h.contexts).toHaveLength(1);
  });
});

describe("contextStillValid and contextKey", () => {
  const ms = (iso: string) => Date.parse(iso);
  const base = ms("2026-10-01T16:00:00.000Z");

  it("holds with no kickoff between the two times; a kickoff at the earlier time had already happened, one at the later time has", () => {
    expect(contextStillValid(base, base, model, snapshot)).toBe(true);
    expect(contextStillValid(base, ms("2026-10-01T23:00:00.000Z"), model, snapshot)).toBe(true);
    expect(contextStillValid(base, ms(THURSDAY), model, snapshot)).toBe(false);
    expect(contextStillValid(ms(THURSDAY), ms("2026-10-03T00:00:00.000Z"), model, snapshot)).toBe(true);
    expect(contextStillValid(ms("2026-10-03T00:00:00.000Z"), base, model, snapshot)).toBe(false); // backwards across it
    expect(contextStillValid(base, ms(SUNDAY) + 1, { nfl: { byeWeek: {}, kickoffs: { 4: { KC: "not a date" } } } }, snapshot)).toBe(true);
    expect(contextStillValid(Number.NaN, base, model, snapshot)).toBe(false);
  });

  it("is built again when the deadline's urgency starts (7 days before) or the deadline passes (ours, on top of M12)", () => {
    const quiet = { nfl: { byeWeek: {}, kickoffs: {} } };
    const weekBefore = ms(DEADLINE) - 7 * 24 * 3600 * 1000;
    expect(contextStillValid(weekBefore - 3600_000, weekBefore - 60_000, quiet, snapshot)).toBe(true);
    expect(contextStillValid(weekBefore - 3600_000, weekBefore + 60_000, quiet, snapshot)).toBe(false);
    expect(contextStillValid(weekBefore + 60_000, ms(DEADLINE) - 60_000, quiet, snapshot)).toBe(true);
    expect(contextStillValid(ms(DEADLINE) - 60_000, ms(DEADLINE) + 60_000, quiet, snapshot)).toBe(false);
  });

  it("keys on the league, its data, the inputs, my team and only the settings the context reads", () => {
    const key = contextKey({ snapshot, model, myTeamId: "3" }, settings);
    expect(key).toBe(`espn|4242|2026|2026-10-01T15:00:00.000Z|2026-10-01T15:01:00.000Z|3|{"goal":"title","prizes":{"first":60,"second":30,"third":10,"weeklyHigh":null,"pointsLeader":null},"returnWeeks":{},"streamPositions":["DEF","K","QB"],"untouchables":[],"waiverSamePosition":true}`);
    // Checkpoint 7e: the untouchables, "Drop from the same position" and the user's return weeks are read by the League model.
    expect(contextKey({ snapshot, model, myTeamId: "3" }, { ...settings, untouchables: ["101"] })).not.toBe(key);
    // The manual playoff weight isn't one of them any more (ω is set automatically; an older version's stored one counts for
    // nothing); the goal is.
    expect(contextKey({ snapshot, model, myTeamId: "3" }, { ...settings, playoffWeight: 1.25 } as TradeSettings)).toBe(key);
    expect(contextKey({ snapshot, model, myTeamId: "3" }, { ...settings, goal: "prizes" })).not.toBe(key);
    // "Several prizes"' amounts too (Checkpoint 7c: the split moves ω and whether the weekly high scores are simulated).
    expect(contextKey({ snapshot, model, myTeamId: "3" }, { ...settings, prizes: { ...settings.prizes, weeklyHigh: 5 } })).not.toBe(key);
    expect(contextKey({ snapshot, model, myTeamId: null }, { ...settings, lambda: 0.9 })).toBe(key.replace("|3|", "|-|"));
  });
});
