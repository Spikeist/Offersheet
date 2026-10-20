/**
 * The engine worker's "now or after this week" replies with the real trade engine (Checkpoint 7e; planner reply to Checkpoint
 * 7d, item 4.2; engine.worker.ts's header, `later`), on a seeded synthetic league (src/engine/trade.testing.ts smallLeague:
 * made-up players, placeholder teams): after the search answers, every card's numbers come under its id, in the cards' order,
 * each the engine's own (evaluate.ts laterNumbers on the search's state, the number the Analyzer gives the same trade), with
 * real timers as in a worker; a re-filter's cards known from before come again at once (memoized). Since Checkpoint 7h a
 * promoted card (a Last offer the search shows in place of its idea: search.ts "Promoted Last offers") gets its line too, from
 * the ladder's version the search keeps for it (the second review, search#2 and offers#1).
 */
import { describe, expect, it } from "vitest";
import { analyzeTrade, buildTradeContext, laterNumbers } from "@/engine/evaluate";
import { searchStateOf } from "@/engine/search";
import { defaultTradeSettings } from "@/engine/settings";
import { TEST_NOW } from "@/engine/testLeague";
import { smallLeague } from "@/engine/trade.testing";
import type { TradeSearchResult } from "@/engine/tradeModel";
import { nowOrLaterView } from "@/lib/tradeView";
import { cardKeysOf, createEngineHandler, laterSourceOf, type EngineResponse, type LaterLine, type TradesRequest } from "./engine.worker";

const league = smallLeague(11);
const NOW = TEST_NOW.toISOString();
const request = (id: number, over: Partial<TradesRequest> = {}): TradesRequest => ({
  type: "trades",
  id,
  snapshot: league.snapshot,
  model: league.inputs,
  myTeamId: league.snapshot.myTeamId,
  nowIso: NOW,
  settings: defaultTradeSettings(),
  partnerId: null,
  ...over,
});

/** Waits until `ok` holds for the replies posted so far. */
async function until(posted: EngineResponse[], ok: (posted: EngineResponse[]) => boolean, timeoutMs = 120_000): Promise<void> {
  const start = Date.now();
  while (!ok(posted)) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

const linesOf = (posted: EngineResponse[], id: number): LaterLine[] => posted.flatMap((r) => (r.type === "later" && r.id === id ? r.result : []));
const doneFor = (id: number) => (posted: EngineResponse[]) => posted.some((r) => r.type === "later" && r.id === id && r.done) || posted.some((r) => r.type === "error" && r.id === id);

describe("the worker's 'now or after this week' replies with the real engine (Checkpoint 7e, item 4.2)", () => {
  it("posts every card's numbers after the search answers, the engine's own, which the Analyzer gives the same trade", { timeout: 180_000 }, async () => {
    const posted: EngineResponse[] = [];
    const handle = createEngineHandler((r) => posted.push(r), { clock: () => performance.now() });
    handle(request(1));
    await until(posted, (p) => p.some((r) => (r.type === "trades" || r.type === "error") && r.id === 1));
    const answer = posted.find((r) => r.id === 1 && (r.type === "trades" || r.type === "error"));
    expect(answer?.type, answer?.type === "error" ? answer.detail : "").toBe("trades");
    const result = (answer as Extract<EngineResponse, { type: "trades" }>).result as TradeSearchResult;
    const keys = cardKeysOf(result);
    expect(keys.length).toBeGreaterThan(0);
    const t0 = performance.now();
    await until(posted, doneFor(1));
    const ms = performance.now() - t0;
    const lines = linesOf(posted, 1);
    expect(lines.map((l) => l.key)).toEqual(keys);
    // Each the engine's own numbers for the card (the handler posts the engine's result object here: no structured clone).
    const state = searchStateOf(result);
    if (!state) throw new Error("no search state");
    for (const l of lines) {
      const x = state.exactByKey.get(l.key) ?? state.versions.get(l.key)?.x;
      if (!x) throw new Error(`no exact trade for ${l.key}`);
      expect(l.later, l.key).toEqual(laterNumbers(state.I, x, state.settings));
      expect(l.later?.b, l.key).not.toBeNull();
    }
    // The Analyzer's evaluation of the first card carries the same numbers, on a context of its own.
    const first = result.trades[0];
    if (!first) throw new Error("no card");
    const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, settings: defaultTradeSettings() });
    expect(analyzeTrade(ctx, first.proposal, { settings: defaultTradeSettings() }).evaluation?.later).toEqual(lines[0]?.later);
    // A re-filter at Any: its cards' numbers under its own id, the ones known from before at once.
    handle({ ...request(2, { settings: { ...defaultTradeSettings(), minChance: 0 } }), type: "refilter", of: 1 });
    await until(posted, doneFor(2));
    const again = posted.find((r): r is Extract<EngineResponse, { type: "trades" }> => r.type === "trades" && r.id === 2)?.result as TradeSearchResult;
    expect(linesOf(posted, 2).map((l) => l.key)).toEqual(cardKeysOf(again));
    for (const l of linesOf(posted, 2)) {
      const before = lines.find((x) => x.key === l.key);
      if (before) expect(l.later).toBe(before.later);
    }
    console.info(`[worker+engine] now-or-later lines: ${lines.length} cards in ${ms.toFixed(0)} ms after the answer (6-team synthetic league)`);
  });

  it("gives a promoted card its line, from the ladder's version the search keeps for it (Checkpoint 7h; the second review, search#2 and offers#1)", { timeout: 180_000 }, async () => {
    // smallLeague 5 (6 teams, 8 availability scenarios, at least 10%: search.promote.test.ts's seed): Overall idea 1 is a
    // promoted Last offer (a smaller ask), shown as a card though the search never evaluated it as one, so its exact trade is
    // only among the search state's versions. Read from exactByKey alone (before the fix), its line was null and the card
    // showed none, though its two Helps you differ by 13.
    const five = smallLeague(5, {}, 6);
    const posted: EngineResponse[] = [];
    const handle = createEngineHandler((r) => posted.push(r), {
      clock: () => performance.now(),
      buildContext: (snapshot, inputs, opts) => buildTradeContext(snapshot, inputs, { ...opts, scenarios: 8 }),
    });
    handle({ ...request(1), snapshot: five.snapshot, model: five.inputs, myTeamId: five.snapshot.myTeamId, settings: { ...defaultTradeSettings(), minChance: 0.1 } });
    await until(posted, doneFor(1));
    const answer = posted.find((r): r is Extract<EngineResponse, { type: "trades" }> => r.type === "trades" && r.id === 1);
    if (!answer) throw new Error("no answer");
    const result = answer.result as TradeSearchResult;
    const idea = result.trades[0];
    if (!idea) throw new Error("no card");
    expect(result.merged?.promoted?.map((p) => p.key)).toContain(idea.key);
    const state = searchStateOf(result);
    if (!state) throw new Error("no search state");
    expect(state.exactByKey.has(idea.key)).toBe(false);
    const version = state.versions.get(idea.key)?.x;
    if (!version) throw new Error("no version for the promoted card");
    // The line the worker posts for it is the engine's own for its trade, and the card shows it.
    const line = linesOf(posted, 1).find((l) => l.key === idea.key)?.later ?? null;
    expect(line).toEqual(laterNumbers(state.I, version, state.settings));
    expect(laterSourceOf(result)?.line(idea.key)).toEqual(line);
    expect(nowOrLaterView(idea, line)?.text).toBe("Helps you 39 now · 52 if done after this week's games.");
  });
});
