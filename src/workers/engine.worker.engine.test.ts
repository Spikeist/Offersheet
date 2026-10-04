/**
 * The engine worker's protocol with the real trade engine (Phase 4 wave 2 decision M12), on a seeded synthetic
 * 10-team league (src/engine/testLeague.ts randomLeague: made-up players, given a round-robin schedule for the rest of
 * the regular season so the season can be simulated): a search runs to the end in slices with
 * progress in stage order, its result survives the structured clone a worker's postMessage makes, Stop ends it
 * between slices, and the Analyzer reuses the search's evaluation context, sending the search's own odds before any
 * trade with its evaluation. The handler runs with real timers, as in a worker. A trade opened from a card's "If they
 * say no, try:" (review of Phase 4b) loses its steps and gets its words again, through the engine's own withWords.
 * Phase 4c: a re-filter at another minimum chance ranks the search's ideas again under "rank" alone, on the same context,
 * and gives what a fresh search at that minimum gives.
 */
import { describe, expect, it } from "vitest";
import { analyzeTrade, buildTradeContext, tradeInternals, withWords } from "@/engine/evaluate";
import type { Matchup } from "@/engine/model";
import { randomLeague } from "@/engine/testLeague";
import { defaultTradeSettings } from "@/engine/settings";
import type { TradeAsset, TradeEvaluation, TradeSearchResult, TradeSearchStage, TradeStep } from "@/engine/tradeModel";
import { createEngineHandler, withoutSteps, type EngineResponse, type TradesRequest } from "./engine.worker";

/** Every team plays every week (the circle method), none decided yet. */
function roundRobin(ids: readonly string[], weeks: readonly number[]): Matchup[] {
  const out: Matchup[] = [];
  weeks.forEach((week, r) => {
    const rest = ids.slice(1);
    const order = [ids[0] as string, ...rest.map((_, i) => rest[(i + r) % rest.length] as string)];
    for (let i = 0; i < order.length / 2; i++) out.push({ week, teamA: order[i] as string, teamB: order[order.length - 1 - i] as string, isPlayoff: false });
  });
  return out;
}

const league = randomLeague({ teams: 10, seed: 20261001, freeAgentsPerPosition: 20 });
const snapshot = { ...league.snapshot, schedule: roundRobin(league.snapshot.teams.map((t) => t.id), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) };
const inputs = league.inputs;
const NOW = "2026-09-30T12:00:00.000Z";
const STAGES: TradeSearchStage[] = ["setup", "screening", "exact", "simScreen", "simFinal", "rank"];

function run(sliceMs = 40) {
  const posted: { at: number; response: EngineResponse }[] = [];
  let contexts = 0;
  const handle = createEngineHandler((response) => posted.push({ at: performance.now(), response }), {
    clock: () => performance.now(),
    sliceMs,
    buildContext: (...args) => {
      contexts++;
      return buildTradeContext(...args);
    },
  });
  return { posted, handle, contexts: () => contexts };
}

const request = (id: number, over: Partial<TradesRequest> = {}): TradesRequest => ({
  type: "trades",
  id,
  snapshot,
  model: inputs,
  myTeamId: "1",
  nowIso: NOW,
  settings: defaultTradeSettings(),
  partnerId: null,
  ...over,
});

/** Waits until a reply of one of these types arrives for `id`. */
async function until(posted: { response: EngineResponse }[], id: number, types: EngineResponse["type"][], timeoutMs = 60_000): Promise<EngineResponse> {
  const start = Date.now();
  for (;;) {
    const hit = posted.find((p) => p.response.id === id && types.includes(p.response.type));
    if (hit) return hit.response;
    if (Date.now() - start > timeoutMs) throw new Error(`no ${types.join("/")} reply for ${id}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("the worker protocol with the real trade engine", () => {
  it("searches in slices with progress in stage order, and its result survives a worker's structured clone", { timeout: 120_000 }, async () => {
    const posted: { at: number; response: EngineResponse }[] = [];
    const handle = createEngineHandler((response) => posted.push({ at: performance.now(), response }), { clock: () => performance.now() });
    const started = performance.now();
    handle(request(1));
    const done = await until(posted, 1, ["trades", "error"]);
    const total = performance.now() - started;
    expect(done.type, done.type === "error" ? done.detail : "").toBe("trades");
    const result = (done as Extract<EngineResponse, { type: "trades" }>).result as TradeSearchResult;
    expect(structuredClone(result)).toEqual(result);
    // Progress came in stage order, one message per slice at most.
    const stages = posted.filter((p) => p.response.type === "progress").map((p) => (p.response as Extract<EngineResponse, { type: "progress" }>).progress.stage);
    const order = stages.map((s) => STAGES.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(stages[0]).toBe("setup");
    expect(result.trades.length).toBeGreaterThan(0);
    // The Analyzer on the same context sends my odds before any trade: the search's own baseline (review of Phase 4:
    // its card's odds then read "(62% to 66%)" as the Finder's do).
    const idea = result.trades[0];
    if (!idea) throw new Error("no trade idea");
    handle({ ...request(2), type: "analyze", proposal: idea.proposal });
    const analyzed = await until(posted, 2, ["analysis", "error"]);
    expect(analyzed.type, analyzed.type === "error" ? analyzed.detail : "").toBe("analysis");
    const analysis = (analyzed as Extract<EngineResponse, { type: "analysis" }>).result;
    expect(typeof result.baseline.pPlayoffs).toBe("number");
    expect(analysis.baseline).toEqual(result.baseline);
    expect(analysis.evaluation?.dPO).toBeCloseTo(idea.dPO ?? Number.NaN, 12);
    // The gaps between replies say how long the worker went without looking at its messages.
    const gaps = posted.slice(1).map((p, i) => p.at - (posted[i]?.at ?? p.at));
    const sorted = [...gaps].sort((a, b) => b - a);
    console.info(
      `[worker+engine] 10-team synthetic league: ${result.trades.length} trades, ${posted.length} replies, total ${total.toFixed(0)} ms; longest gaps ${sorted
        .slice(0, 3)
        .map((g) => g.toFixed(0))
        .join(", ")} ms; engine timings ${JSON.stringify(Object.fromEntries(Object.entries(result.timings).map(([k, v]) => [k, Math.round(v)])))}`,
    );
  });

  it("stops between slices on cancel, and the Analyzer then reuses the context the search built", { timeout: 120_000 }, async () => {
    const h = run();
    h.handle(request(1));
    await until(h.posted, 1, ["progress"]);
    // Wait for a slice of real search work, then stop.
    const start = Date.now();
    while (!h.posted.some((p) => p.response.type === "progress" && (p.response as Extract<EngineResponse, { type: "progress" }>).progress.stage !== "setup")) {
      if (Date.now() - start > 60_000) throw new Error("the search never started");
      await new Promise((r) => setTimeout(r, 5));
    }
    h.handle({ type: "cancel", id: 1 });
    expect(h.posted.at(-1)?.response).toEqual({ type: "cancelled", id: 1 });
    const replies = h.posted.length;
    await new Promise((r) => setTimeout(r, 200));
    expect(h.posted).toHaveLength(replies);
    expect(h.posted.some((p) => p.response.type === "trades")).toBe(false);
    // The Analyzer on the same league, team, settings and time: no second context.
    const mine = snapshot.teams[0]?.roster[1] as string;
    const theirs = snapshot.teams[1]?.roster[1] as string;
    const t0 = performance.now();
    h.handle({ ...request(2), type: "analyze", proposal: { partnerId: "2", give: [{ kind: "player", id: mine }], get: [{ kind: "player", id: theirs }] } });
    const ms = performance.now() - t0;
    const analysis = h.posted.at(-1)?.response;
    expect(analysis?.type, analysis?.type === "error" ? analysis.detail : "").toBe("analysis");
    expect(structuredClone(analysis)).toEqual(analysis);
    expect(h.contexts()).toBe(1);
    console.info(`[worker+engine] Analyzer on the cached context: ${ms.toFixed(0)} ms`);
  });

  it("re-filters a search's ideas at another minimum chance with no new search, giving what a fresh search at that minimum gives (Phase 4c)", { timeout: 180_000 }, async () => {
    const h = run();
    h.handle(request(1));
    const searched = await until(h.posted, 1, ["trades", "error"]);
    expect(searched.type, searched.type === "error" ? searched.detail : "").toBe("trades");
    const first = (searched as Extract<EngineResponse, { type: "trades" }>).result;
    expect(first.filter?.minChance).toBe(defaultTradeSettings().minChance);
    // Any (0): the worker ranks the same finalists again, on the same context.
    const any = { ...defaultTradeSettings(), minChance: 0 };
    h.handle({ ...request(2, { settings: any }), type: "refilter", of: 1 });
    const refiltered = await until(h.posted, 2, ["trades", "error"]);
    expect(refiltered.type, refiltered.type === "error" ? refiltered.detail : "").toBe("trades");
    const again = (refiltered as Extract<EngineResponse, { type: "trades" }>).result;
    const stages = h.posted.filter((p) => p.response.id === 2 && p.response.type === "progress").map((p) => (p.response as Extract<EngineResponse, { type: "progress" }>).progress.stage);
    expect(new Set(stages)).toEqual(new Set(["rank"]));
    expect(h.contexts()).toBe(1);
    // It reads like the search: the search's own timings, the re-filter's apart.
    expect(again.timings.screening).toBe(first.timings.screening);
    expect(typeof again.timings.refilter).toBe("number");
    // A fresh search at Any on a new handler gives the same list.
    const fresh = run();
    fresh.handle(request(3, { settings: any }));
    const freshDone = await until(fresh.posted, 3, ["trades", "error"]);
    const freshResult = (freshDone as Extract<EngineResponse, { type: "trades" }>).result;
    const shape = (r: TradeSearchResult) => ({ keys: r.trades.map((t) => t.key), filter: r.filter, hidden: r.hidden, pattern: r.pattern ?? null, overall: r.trades.map((t) => t.overall), planB: r.trades.map((t) => t.planB?.key ?? null) });
    expect(shape(again)).toEqual(shape(freshResult));
    expect(again.filter?.minChance).toBe(0);
    console.info(`[worker+engine] re-filter to Any: ${first.trades.length} → ${again.trades.length} ideas in ${Math.round(again.timings.refilter ?? Number.NaN)} ms`);
  });

  it("words a trade opened from 'If they say no, try:' without its steps: same numbers, a message for the trade itself (review of Phase 4b)", { timeout: 120_000 }, () => {
    const ctx = buildTradeContext({ ...snapshot, myTeamId: "1" }, inputs, { now: new Date(NOW), settings: defaultTradeSettings() });
    const [a, b] = (snapshot.teams[0]?.roster ?? []).slice(1, 3);
    const theirs = snapshot.teams[1]?.roster[1];
    if (!a || !b || !theirs) throw new Error("the synthetic league has no players");
    const player = (id: string): TradeAsset => ({ kind: "player", id });
    const analysis = analyzeTrade(ctx, { partnerId: "2", give: [player(a), player(b)], get: [player(theirs)] }, { settings: defaultTradeSettings() });
    const e = analysis.evaluation;
    if (!e) throw new Error(analysis.illegal ?? "the trade wasn't evaluated");
    // The same trade with steps (offer my first player alone first), worded by the engine: its pitch names the first offer.
    const offerFirst: TradeStep = { ...e, proposal: { partnerId: "2", give: [player(a)], get: [player(theirs)] }, key: `2|give:${a}|get:${theirs}`, b: e.b, tradeScore: e.tradeScore };
    const { reasons: _r, pitch: _p, ...core } = e;
    void _r;
    void _p;
    const stepped: TradeEvaluation = withWords(tradeInternals(ctx), { ...core, steps: { offerFirst, ifNo: { add: b, full: { ...offerFirst, proposal: e.proposal, key: e.key } }, ranked: "full" } });
    const name = (id: string) => snapshot.players[id]?.name ?? id;
    expect(stepped.pitch).not.toContain(name(b));
    const opened = withoutSteps(ctx, { ...analysis, evaluation: stepped }).evaluation;
    expect(opened?.steps).toBeUndefined();
    expect(opened?.pitch).toContain(name(a));
    expect(opened?.pitch).toContain(name(b));
    expect(opened?.pitch).toBe(e.pitch);
    expect([opened?.b, opened?.pAccept, opened?.pComplete, opened?.overall]).toEqual([e.b, e.pAccept, e.pComplete, e.overall]);
    expect(opened?.reasons).toEqual(e.reasons);
  });
});
