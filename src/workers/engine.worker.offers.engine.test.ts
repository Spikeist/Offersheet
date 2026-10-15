/**
 * The engine worker's `offers` request with the real trade engine (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1;
 * engine.worker.ts's header, `offers`), on a seeded synthetic league (src/engine/trade.testing.ts smallLeague: made-up
 * players, placeholder teams): after a search answers, a card's "How to offer it" from the worker is the engine's own
 * (offers.ts offerLadderOfSearch on a fresh search of the same league: deterministic), timed, and survives the structured
 * clone a worker's postMessage makes; a second open is the ladder kept; the Analyzer's card and a card whose result the worker
 * doesn't keep are offers.ts offerLadderOfProposal's, on pages "analysis" and "finder". Checkpoint 7f (search.ts, "Merged
 * cards"): a card a trade was merged into gets the very ladder the search's merge read, holding that trade, and the same one
 * worked out from its trade when the worker no longer keeps the result.
 */
import { describe, expect, it } from "vitest";
import { buildTradeContext } from "@/engine/evaluate";
import { offerLadderOfProposal, offerLadderOfSearch } from "@/engine/offers";
import { runTradeSearch, searchStateOf } from "@/engine/search";
import { defaultTradeSettings } from "@/engine/settings";
import { TEST_NOW } from "@/engine/testLeague";
import { smallLeague } from "@/engine/trade.testing";
import type { OfferLadder, TradeSearchResult } from "@/engine/tradeModel";
import { createEngineHandler, type EngineResponse, type OffersRequest, type OffersSource, type TradesRequest } from "./engine.worker";

/** smallLeague(1): its cards' ladders hold offers besides the card (offers.test.ts: a fact of the synthetic data). */
const league = smallLeague(1);
const NOW = TEST_NOW.toISOString();
const settings = { ...defaultTradeSettings(), minChance: 0.1 };
/** 8 availability scenarios, here and on the worker's context, for speed (the rules don't depend on how many). */
const SCENARIOS = 8;
const job = { snapshot: league.snapshot, model: league.inputs, myTeamId: league.snapshot.myTeamId, nowIso: NOW, settings };
const trades = (id: number): TradesRequest => ({ type: "trades", id, ...job, partnerId: null });
const offers = (id: number, source: OffersSource): OffersRequest => ({ type: "offers", id, ...job, source });

/** Waits until a reply of one of these types arrives for `id`. */
async function until(posted: EngineResponse[], id: number, types: EngineResponse["type"][], timeoutMs = 120_000): Promise<EngineResponse> {
  const start = Date.now();
  for (;;) {
    const hit = posted.find((r) => r.id === id && types.includes(r.type));
    if (hit) return hit;
    if (Date.now() - start > timeoutMs) throw new Error(`no ${types.join("/")} reply for ${id}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const ladderOf = (r: EngineResponse | undefined): OfferLadder => {
  expect(r?.type, r?.type === "error" ? r.detail : "").toBe("offers");
  return (r as Extract<EngineResponse, { type: "offers" }>).result;
};
/** A ladder without its build time (the only thing a clock changes). */
const untimed = (l: OfferLadder | null): Omit<OfferLadder, "ms"> | null => {
  if (!l) return null;
  const { ms: _ms, ...rest } = l;
  void _ms;
  return rest;
};

describe("the worker's 'How to offer it' with the real engine (Checkpoint 7e, item 4.1)", () => {
  it("a search's cards: the engine's own ladders, timed, kept for a second open, and they survive a worker's structured clone", { timeout: 300_000 }, async () => {
    const posted: EngineResponse[] = [];
    const handle = createEngineHandler((r) => posted.push(r), {
      clock: () => performance.now(),
      buildContext: (snapshot, model, o) => buildTradeContext(snapshot, model, { ...o, scenarios: SCENARIOS }),
    });
    handle(trades(1));
    const answered = await until(posted, 1, ["trades", "error"]);
    expect(answered.type, answered.type === "error" ? answered.detail : "").toBe("trades");
    const result = (answered as Extract<EngineResponse, { type: "trades" }>).result as TradeSearchResult;
    const cards = result.trades.slice(0, 3);
    expect(cards.length).toBeGreaterThan(0);
    // The same league searched afresh on a context of its own: the same cards, the same ladders.
    const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, settings, scenarios: SCENARIOS });
    const fresh = runTradeSearch(ctx, { settings });
    expect(fresh.trades.map((t) => t.key)).toEqual(result.trades.map((t) => t.key));
    let id = 10;
    let offered = 0;
    for (const card of cards) {
      handle(offers(++id, { kind: "search", resultId: 1, key: card.key }));
      const ladder = ladderOf(posted.find((r) => r.id === id));
      expect(untimed(ladder), card.key).toEqual(untimed(offerLadderOfSearch(fresh, card.key)));
      // Timed (a ladder the search kept for its merge takes next to nothing to hand back: Checkpoint 7f).
      expect(ladder.ms, card.key).toBeGreaterThanOrEqual(0);
      expect(structuredClone(ladder)).toEqual(ladder);
      if (ladder.steps.length > 1) offered++;
      // A second open: the ladder kept.
      handle(offers(++id, { kind: "search", resultId: 1, key: card.key }));
      expect(ladderOf(posted.find((r) => r.id === id))).toBe(ladder);
    }
    expect(offered).toBeGreaterThan(0);
  });

  it("the Analyzer's card, and a Finder card whose result the worker doesn't keep: offerLadderOfProposal's, on pages \"analysis\" and \"finder\"", { timeout: 300_000 }, async () => {
    const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, settings, scenarios: SCENARIOS });
    const card = runTradeSearch(ctx, { settings }).trades[0];
    if (!card) throw new Error("no card");
    const posted: EngineResponse[] = [];
    const handle = createEngineHandler((r) => posted.push(r), { buildContext: (snapshot, model, o) => buildTradeContext(snapshot, model, { ...o, scenarios: SCENARIOS }) });
    handle(offers(1, { kind: "analysis", proposal: card.proposal }));
    handle(offers(2, { kind: "search", resultId: -1, key: card.key }));
    const fresh = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, settings, scenarios: SCENARIOS });
    expect(ladderOf(posted.find((r) => r.id === 1))).toEqual(offerLadderOfProposal(fresh, card.proposal, { settings, page: "analysis" }));
    expect(ladderOf(posted.find((r) => r.id === 2))).toEqual(offerLadderOfProposal(fresh, card.proposal, { settings, page: "finder" }));
  });

  it("Checkpoint 7f: a card a trade was merged into gets the ladder the search's merge read, holding that trade; worked out from its trade when the result isn't kept, the same ladder (smallLeague 48 merges: a fact of the synthetic data)", { timeout: 300_000 }, async () => {
    const merging = smallLeague(48);
    const base = { ...job, snapshot: merging.snapshot, model: merging.inputs, myTeamId: merging.snapshot.myTeamId };
    const posted: EngineResponse[] = [];
    const handle = createEngineHandler((r) => posted.push(r), { buildContext: (snapshot, model, o) => buildTradeContext(snapshot, model, { ...o, scenarios: SCENARIOS }) });
    handle({ type: "trades", id: 1, ...base, partnerId: null });
    const answered = await until(posted, 1, ["trades", "error"]);
    expect(answered.type, answered.type === "error" ? answered.detail : "").toBe("trades");
    const result = (answered as Extract<EngineResponse, { type: "trades" }>).result as TradeSearchResult;
    const merged = result.merged?.overall ?? [];
    expect(merged.length).toBeGreaterThan(0);
    const kept = searchStateOf(result)?.ladders;
    let id = 10;
    for (const keeper of new Set(merged.map((m) => m.into))) {
      handle({ type: "offers", id: ++id, ...base, source: { kind: "search", resultId: 1, key: keeper } });
      const ladder = ladderOf(posted.find((r) => r.id === id));
      // The very ladder the merge read (no clock here, so nothing to set apart), holding each trade merged into the card.
      expect(ladder, keeper).toBe(kept?.get(keeper));
      for (const m of merged.filter((x) => x.into === keeper)) expect(ladder.steps.find((s) => s.evaluation.key === m.key)?.kind, m.key).toBe(m.kind);
      // Its trade worked out afresh (a result the worker no longer keeps): the same offers.
      const card = result.trades.find((t) => t.key === keeper);
      handle({ type: "offers", id: ++id, ...base, source: { kind: "search", resultId: -1, key: keeper, ...(card ? { proposal: card.proposal } : {}) } });
      expect(ladderOf(posted.find((r) => r.id === id)), keeper).toEqual(ladder);
    }
  });
});
