/**
 * The engine worker's `offers` request (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1, "How to offer it": "When to
 * build it: when the user opens a card's 'How to offer it,' in the Web Worker"; engine.worker.ts's header, `offers`), through
 * its handler with fakes: a Trade Finder card by the id of the search (or re-filter) whose result holds it and its key, built
 * from that kept result; ⚠️ a card whose result the worker no longer keeps (an unknown id, -1, a result a new context forgot,
 * or one that can't give it) worked out the Analyzer's way from the trade its key names, on the context for the request with
 * its settings; the Analyzer's card by its proposal; each ladder kept per result (or context and settings) and card, so a
 * second open answers at once; the engine's clock passed only when the handler has one; and the failures: a key that names
 * no trade, a ladder that throws, a source that isn't one; since Checkpoint 7g the preference a card's search recorded, passed
 * to that fallback and in its ladder's key. The real engine's ladders: engine.worker.offers.engine.test.ts.
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
import type { ProposalLadderOptions } from "@/engine/offers";
import { defaultTradeSettings, type TradeSettings } from "@/engine/settings";
import type { OfferLadder, TradeEvaluation, TradeProposal, TradeSearchProgress, TradeSearchResult } from "@/engine/tradeModel";
import { ENGINE_ERROR_MESSAGE, createEngineHandler, type EngineHandlerDeps, type EngineResponse, type OffersRequest, type OffersSource, type TradesRequest } from "./engine.worker";

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
const offers = (id: number, source: OffersSource, extra: Partial<OffersRequest> = {}): OffersRequest => ({ type: "offers", id, snapshot, model, myTeamId: "3", nowIso: NOW, settings, source, ...extra });

const KEY_A = "6|give:101|get:202,203";
const KEY_B = "4|give:101,104|get:301";
const proposal: TradeProposal = { partnerId: "6", give: [{ kind: "player", id: "101" }], get: [{ kind: "player", id: "203" }, { kind: "player", id: "202" }] };
const card = (key: string) => ({ key }) as unknown as TradeEvaluation;
const ladderFor = (cardKey: string, from: string): OfferLadder => ({ cardKey, steps: [{ kind: "suggested", evaluation: card(cardKey), message: from }] });

/**
 * A harness: the handler with a timer run by hand; each search answers with a result holding `cards` (the result objects in
 * order of the searches); the fake ladders record each call (`bySearch`: the result and key; `byProposal`: the context, the
 * proposal and the options) and answer with a ladder naming where it came from; `searchGives` false: the kept result can't
 * give one (no state, as offerLadderOfSearch answers then).
 */
function harness(opts: { cards?: string[]; searchGives?: boolean; throwOn?: "search" | "proposal"; clock?: boolean } = {}) {
  const posted: EngineResponse[] = [];
  const queue: (() => void)[] = [];
  const results: TradeSearchResult[] = [];
  const contexts: TradeContext[] = [];
  const bySearch: { result: TradeSearchResult; key: string; opts: unknown }[] = [];
  const byProposal: { ctx: TradeContext; proposal: TradeProposal; opts: ProposalLadderOptions | undefined }[] = [];
  const buildContext = (() => {
    const ctx = { myTeamId: "3", partnerIds: [], notes: [], warnings: [], timings: {}, n: contexts.length + 1 } as unknown as TradeContext;
    contexts.push(ctx);
    return ctx;
  }) as NonNullable<EngineHandlerDeps["buildContext"]>;
  const search = (() =>
    (function* (): Generator<TradeSearchProgress, TradeSearchResult, void> {
      yield { stage: "screening", done: 1, total: 1 };
      const result = { trades: (opts.cards ?? [KEY_A, KEY_B]).map(card), notes: [], warnings: [], timings: { total: 1 } } as unknown as TradeSearchResult;
      results.push(result);
      return result;
    })()) as unknown as NonNullable<EngineHandlerDeps["search"]>;
  const offersOfSearch = ((result: TradeSearchResult, key: string, o?: unknown) => {
    bySearch.push({ result, key, opts: o });
    if (opts.throwOn === "search") throw new RangeError("no ladder");
    return opts.searchGives === false ? null : ladderFor(key, "search");
  }) as NonNullable<EngineHandlerDeps["offersOfSearch"]>;
  const offersOfProposal = ((ctx: TradeContext, p: TradeProposal, o?: ProposalLadderOptions) => {
    byProposal.push({ ctx, proposal: p, opts: o });
    if (opts.throwOn === "proposal") throw new RangeError("no ladder");
    return ladderFor(`${p.partnerId}|${o?.page}`, "proposal");
  }) as NonNullable<EngineHandlerDeps["offersOfProposal"]>;
  let time = 0;
  const handle = createEngineHandler((r) => posted.push(r), {
    buildContext,
    search,
    offersOfSearch,
    offersOfProposal,
    laterSource: () => null,
    schedule: (fn) => void queue.push(fn),
    ...(opts.clock === false ? {} : { clock: () => (time += 1) }),
  });
  return {
    handle,
    posted,
    results,
    contexts,
    bySearch,
    byProposal,
    runAll: () => {
      while (queue.length) queue.shift()?.();
    },
    reply: (id: number) => posted.find((r) => r.id === id && r.type !== "progress"),
  };
}

/** A search run to its answer. */
function answer(h: ReturnType<typeof harness>, id: number, extra: Partial<TradesRequest> = {}): TradeSearchResult {
  h.handle(trades(id, extra));
  h.runAll();
  const r = h.posted.find((x): x is Extract<EngineResponse, { type: "trades" }> => x.type === "trades" && x.id === id);
  expect(r).toBeDefined();
  return (r as Extract<EngineResponse, { type: "trades" }>).result;
}

describe("the worker's 'How to offer it' (Checkpoint 7e, item 4.1)", () => {
  it("builds a Finder card's offers from the result its search answered with, at once, once per card", () => {
    const h = harness();
    const result = answer(h, 1);
    h.handle(offers(2, { kind: "search", resultId: 1, key: KEY_A }));
    // One piece of work, no timer: the reply is there at once.
    expect(h.reply(2)).toEqual({ type: "offers", id: 2, result: ladderFor(KEY_A, "search") });
    expect(h.bySearch).toHaveLength(1);
    expect(h.bySearch[0]?.result).toBe(result);
    expect(h.bySearch[0]?.key).toBe(KEY_A);
    // The engine's own clock goes with it (the handler has one).
    expect(h.bySearch[0]?.opts).toMatchObject({ clock: expect.any(Function) });
    // A second open of the same card: the ladder kept, the very same object, nothing built again.
    h.handle(offers(3, { kind: "search", resultId: 1, key: KEY_A }));
    expect((h.reply(3) as Extract<EngineResponse, { type: "offers" }>).result).toBe((h.reply(2) as Extract<EngineResponse, { type: "offers" }>).result);
    expect(h.bySearch).toHaveLength(1);
    // Another card: built once more. No context was built for any of it but the search's.
    h.handle(offers(4, { kind: "search", resultId: 1, key: KEY_B }));
    expect(h.reply(4)).toEqual({ type: "offers", id: 4, result: ladderFor(KEY_B, "search") });
    expect(h.bySearch.map((c) => c.key)).toEqual([KEY_A, KEY_B]);
    expect(h.byProposal).toEqual([]);
    expect(h.contexts).toHaveLength(1);
  });

  it("⚠️ a card whose result isn't kept is worked out from the trade its key names, the Analyzer's way, on the context for the request (page \"finder\"), once per context, settings and card", () => {
    const h = harness();
    answer(h, 1);
    // An id the worker never answered, and none (-1).
    for (const [id, resultId] of [
      [2, 7],
      [3, -1],
    ] as const) {
      h.handle(offers(id, { kind: "search", resultId, key: KEY_A }));
      expect(h.reply(id)).toEqual({ type: "offers", id, result: ladderFor("6|finder", "proposal") });
    }
    // Built once (the second asked for the same card with the same settings on the same context), from the key's trade.
    expect(h.byProposal).toHaveLength(1);
    expect(h.byProposal[0]?.ctx).toBe(h.contexts[0]);
    expect(h.byProposal[0]?.proposal).toEqual({ partnerId: "6", give: [{ kind: "player", id: "101" }], get: [{ kind: "player", id: "202" }, { kind: "player", id: "203" }] });
    expect(h.byProposal[0]?.opts).toMatchObject({ settings, page: "finder", clock: expect.any(Function) });
    // Other settings (the per-call ones: a new minimum chance): built again, on the same context.
    h.handle(offers(4, { kind: "search", resultId: -1, key: KEY_A }, { settings: { ...settings, minChance: 0.3 } }));
    expect(h.byProposal).toHaveLength(2);
    expect(h.byProposal[1]?.opts?.settings?.minChance).toBe(0.3);
    expect(h.contexts).toHaveLength(1);
    // A result a new context forgot (a search with another setting the context reads built it): from the key, on the new one.
    const other = { ...settings, streamPositions: ["K" as const] };
    answer(h, 5, { settings: other });
    expect(h.contexts).toHaveLength(2);
    h.handle(offers(6, { kind: "search", resultId: 1, key: KEY_B }, { settings: other }));
    expect(h.byProposal[2]?.ctx).toBe(h.contexts[1]);
    expect(h.byProposal[2]?.proposal.partnerId).toBe("4");
    expect(h.bySearch).toEqual([]);
    // The new search's own cards come from its result.
    h.handle(offers(7, { kind: "search", resultId: 5, key: KEY_B }, { settings: other }));
    expect(h.bySearch.map((c) => c.result)).toEqual([h.results[1]]);
  });

  it("⚠️ a kept result answers for its cards whatever the request's settings or moment: the offers are the card's as it was found", () => {
    const h = harness();
    const result = answer(h, 1);
    // Another setting the context reads, without a search since: the card shown is still the kept result's.
    h.handle(offers(2, { kind: "search", resultId: 1, key: KEY_A }, { settings: { ...settings, streamPositions: ["K"] } }));
    expect(h.reply(2)).toEqual({ type: "offers", id: 2, result: ladderFor(KEY_A, "search") });
    expect(h.bySearch[0]?.result).toBe(result);
    expect(h.contexts).toHaveLength(1);
  });

  it("⚠️ a kept result that can't give the card's offers (no search state): the same fallback", () => {
    const h = harness({ searchGives: false });
    answer(h, 1);
    h.handle(offers(2, { kind: "search", resultId: 1, key: KEY_A }));
    expect(h.bySearch).toHaveLength(1);
    expect(h.byProposal).toHaveLength(1);
    expect(h.reply(2)).toEqual({ type: "offers", id: 2, result: ladderFor("6|finder", "proposal") });
  });

  it("the Analyzer's card by its proposal (page \"analysis\", its players in its own order), once per context, settings and proposal", () => {
    const h = harness({ clock: false });
    h.handle(offers(1, { kind: "analysis", proposal }));
    expect(h.reply(1)).toEqual({ type: "offers", id: 1, result: ladderFor("6|analysis", "proposal") });
    expect(h.byProposal[0]?.proposal).toEqual(proposal);
    // No clock given to the handler: none passed to the engine.
    expect(h.byProposal[0]?.opts).toEqual({ settings, page: "analysis" });
    h.handle(offers(2, { kind: "analysis", proposal }));
    expect(h.byProposal).toHaveLength(1);
    // The same trade from the Trade Finder's side is another card (another per-side limit).
    h.handle(offers(3, { kind: "search", resultId: -1, key: KEY_A }));
    expect(h.byProposal.map((c) => c.opts?.page)).toEqual(["analysis", "finder"]);
  });

  it("answers an error for a key that names no trade, a ladder that throws, and a source that isn't one; other requests go on", () => {
    const h = harness();
    answer(h, 1);
    h.handle(offers(2, { kind: "search", resultId: -1, key: "not a key" }));
    expect(h.reply(2)).toMatchObject({ type: "error", id: 2, message: ENGINE_ERROR_MESSAGE, detail: "Error: The card's trade can't be read from its key." });
    h.handle(offers(3, { kind: "search", resultId: 1, key: "" }));
    expect(h.reply(3)).toMatchObject({ type: "error", id: 3, detail: "Not an engine request." });
    h.handle(offers(4, { kind: "elsewhere" } as unknown as OffersSource));
    expect(h.reply(4)).toMatchObject({ type: "error", id: 4, detail: "Not an engine request." });
    h.handle(offers(5, { kind: "analysis", proposal: { partnerId: 6 } } as unknown as OffersSource));
    expect(h.reply(5)).toMatchObject({ type: "error", id: 5, detail: "Not an engine request." });
    const failing = harness({ throwOn: "proposal" });
    failing.handle(offers(1, { kind: "analysis", proposal }));
    expect(failing.reply(1)).toEqual({ type: "error", id: 1, message: ENGINE_ERROR_MESSAGE, detail: "RangeError: no ladder" });
    // Nothing kept from a failure: asked again, it's built again.
    failing.handle(offers(2, { kind: "analysis", proposal }));
    expect(failing.byProposal).toHaveLength(2);
    // The worker still searches.
    answer(failing, 3);
  });

  it("⚠️ a card whose result isn't kept: its trade in the card's own order (the review of wave D, D-ENG-3 and UI-D-4); the barred keys an older page sends read and ignored (Checkpoint 7f: nothing is barred)", () => {
    const h = harness();
    answer(h, 1);
    const own: TradeProposal = { partnerId: "6", give: [{ kind: "player", id: "101" }], get: [{ kind: "player", id: "203" }, { kind: "player", id: "202" }] };
    h.handle(offers(2, { kind: "search", resultId: -1, key: KEY_A, proposal: own, barred: ["6|give:101,104|get:202,203", KEY_B] }));
    expect(h.reply(2)).toMatchObject({ type: "offers", id: 2 });
    // The card's own order (203 before 202), not the key's id order; no barred keys passed on.
    expect(h.byProposal[0]?.proposal).toEqual(own);
    expect(h.byProposal[0]?.opts?.barred).toBeUndefined();
    // Other barred keys, or none: the same card, the ladder kept.
    h.handle(offers(3, { kind: "search", resultId: -1, key: KEY_A, proposal: own, barred: [KEY_B] }));
    h.handle(offers(4, { kind: "search", resultId: -1, key: KEY_A, proposal: own }));
    expect(h.byProposal).toHaveLength(1);
    const ladderOf = (id: number) => (h.reply(id) as Extract<EngineResponse, { type: "offers" }>).result;
    expect(ladderOf(3)).toBe(ladderOf(2));
    expect(ladderOf(4)).toBe(ladderOf(2));
    // A proposal that isn't the key's trade isn't trusted: the key's trade.
    const wrong: TradeProposal = { partnerId: "6", give: [{ kind: "player", id: "999" }], get: [] };
    h.handle(offers(5, { kind: "search", resultId: -1, key: KEY_A, proposal: wrong }));
    expect(h.byProposal[1]?.proposal).toEqual({ partnerId: "6", give: [{ kind: "player", id: "101" }], get: [{ kind: "player", id: "202" }, { kind: "player", id: "203" }] });
    // A source whose barred keys aren't strings still isn't one.
    h.handle(offers(6, { kind: "search", resultId: -1, key: KEY_A, barred: [7] } as unknown as OffersSource));
    expect(h.reply(6)).toMatchObject({ type: "error", id: 6, detail: "Not an engine request." });
  });

  it("Checkpoint 7g: a card whose result isn't kept is worked out with the preference its search recorded (the source's `prefer`), which keys its ladder; a request without it (an older page's) still answers, without one; one whose `prefer` isn't strings isn't a source", () => {
    const h = harness();
    answer(h, 1);
    const prefer = ["6|give:101|get:202", "6|give:101|get:203"];
    h.handle(offers(2, { kind: "search", resultId: -1, key: KEY_A, proposal, prefer: [prefer[1] as string, prefer[0] as string] }));
    expect(h.reply(2)).toMatchObject({ type: "offers", id: 2 });
    // Passed on sorted, each once.
    expect(h.byProposal[0]?.opts?.prefer).toEqual(prefer);
    // The same preference in another order: the ladder kept; none, or another: worked out again, each its own.
    h.handle(offers(3, { kind: "search", resultId: -1, key: KEY_A, proposal, prefer }));
    expect(h.byProposal).toHaveLength(1);
    h.handle(offers(4, { kind: "search", resultId: -1, key: KEY_A, proposal }));
    expect(h.reply(4)).toMatchObject({ type: "offers", id: 4 });
    expect(h.byProposal).toHaveLength(2);
    expect(h.byProposal[1]?.opts?.prefer).toBeUndefined();
    h.handle(offers(5, { kind: "search", resultId: -1, key: KEY_A, proposal, prefer: [prefer[0] as string] }));
    expect(h.byProposal).toHaveLength(3);
    expect(h.byProposal[2]?.opts?.prefer).toEqual([prefer[0]]);
    // The Analyzer's card has no list, so no preference.
    h.handle(offers(6, { kind: "analysis", proposal }));
    expect(h.byProposal[3]?.opts?.prefer).toBeUndefined();
    // Not strings: not a source.
    h.handle(offers(7, { kind: "search", resultId: -1, key: KEY_A, prefer: [7] } as unknown as OffersSource));
    expect(h.reply(7)).toMatchObject({ type: "error", id: 7, detail: "Not an engine request." });
  });

  it("⚠️ an offers request never replaces the context the searches use nor forgets the kept results: its own context waits aside (the review of wave D, D-ENG-8 and UI-D-4)", () => {
    const h = harness();
    const old = { ...settings, streamPositions: ["K" as const] };
    // Search 1 under the old settings, then search 2 under the new ones (a setting the context reads): the dimmed ideas' case.
    answer(h, 1, { settings: old });
    const second = answer(h, 2);
    expect(h.contexts).toHaveLength(2);
    // Search 1's result went with its context; its card's offers, asked with its own settings, build a context aside.
    h.handle(offers(3, { kind: "search", resultId: 1, key: KEY_A }, { settings: old }));
    expect(h.reply(3)).toMatchObject({ type: "offers", id: 3 });
    expect(h.contexts).toHaveLength(3);
    expect(h.byProposal[0]?.ctx).toBe(h.contexts[2]);
    // Another card of the dimmed ideas: the same aside context, nothing built.
    h.handle(offers(4, { kind: "search", resultId: 1, key: KEY_B }, { settings: old }));
    expect(h.byProposal[1]?.ctx).toBe(h.contexts[2]);
    expect(h.contexts).toHaveLength(3);
    // The newer search's result is still kept, and a search under its settings runs on its context: nothing built.
    h.handle(offers(5, { kind: "search", resultId: 2, key: KEY_A }));
    expect(h.bySearch.map((c) => c.result)).toEqual([second]);
    answer(h, 6);
    expect(h.contexts).toHaveLength(3);
    // Once a search has answered, the aside context is gone: the old settings' offers build one again.
    h.handle(offers(7, { kind: "search", resultId: 1, key: KEY_A, proposal: { partnerId: "6", give: [{ kind: "player", id: "101" }], get: [{ kind: "player", id: "202" }, { kind: "player", id: "203" }] } }, { settings: old }));
    expect(h.contexts).toHaveLength(4);
    expect(h.byProposal.at(-1)?.ctx).toBe(h.contexts[3]);
  });

  it("answers between the slices of a search under way, which then finishes as usual", () => {
    const h = harness();
    answer(h, 1);
    h.handle(trades(2));
    // The search has posted its first progress and waits for its timer; the card's offers go first.
    h.handle(offers(3, { kind: "search", resultId: 1, key: KEY_B }));
    expect(h.reply(3)).toEqual({ type: "offers", id: 3, result: ladderFor(KEY_B, "search") });
    h.runAll();
    expect(h.posted.some((r) => r.type === "trades" && r.id === 2)).toBe(true);
    expect(h.posted.some((r) => r.type === "cancelled")).toBe(false);
  });
});
