/**
 * The engine client (CLAUDE.md §3: the engine runs in a Web Worker; Phase 4 wave 2 decision M12): replies are
 * matched by request id, errors reject, a search reports progress and can be stopped (or is stopped by a newer
 * one), and the main thread takes over when there's no worker or it fails. A fake worker and a fake main-thread
 * engine stand in for the real ones (Vitest runs in Node).
 */
import { describe, expect, it } from "vitest";
import type { LeagueModel } from "@/engine/leagueModel";
import { defaultTradeSettings } from "@/engine/settings";
import type { TradeSearchResult } from "@/engine/tradeModel";
import type { AnalyzerResult, EngineRequest, EngineResponse } from "@/workers/engine.worker";
import { ENGINE_STOPPED, EngineError, SEARCH_CANCELLED, createEngineClient, type LeagueJob, type MainThreadEngine, type TradesJob, type WorkerLike } from "./engineClient";

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: EngineRequest[] = [];
  terminated = false;
  postMessage(message: EngineRequest): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(response: unknown): void {
    this.onmessage?.({ data: response } as MessageEvent);
  }
  crash(): void {
    let prevented = false;
    this.onerror?.({ preventDefault: () => (prevented = true) } as unknown as ErrorEvent);
    if (!prevented) throw new Error("the client should handle the worker's error event");
  }
}

const result = (label: string) => ({ weeks: [4], label }) as unknown as LeagueModel;
const job = (myTeamId: string | null = "1"): LeagueJob => ({
  snapshot: { leagueId: "4242" } as never,
  model: { version: 1 } as never,
  myTeamId,
  nowIso: "2026-09-30T02:00:00.000Z",
  settings: defaultTradeSettings(),
});
const tradesJob = (partnerId: string | null = null): TradesJob => ({ ...job(), partnerId });
const searchResult = (label: string) => ({ trades: [], notes: [label] }) as unknown as TradeSearchResult;
/** An Analyzer reply: the evaluation and my odds before any trade (engine.worker.ts AnalyzerResult). */
const analysis: AnalyzerResult = { evaluation: null, illegal: "No players in this trade.", notes: [], baseline: { pPlayoffs: 0.71, pTitle: 0.15, expWins: 8.4 } };
const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * A fake main-thread engine: it records what it's sent and answers league and analyze requests at once;
 * searches wait for the test (`post`).
 */
function mainThreadEngine() {
  const sent: EngineRequest[] = [];
  let post: (r: EngineResponse) => void = () => {};
  let starts = 0;
  const start = async (p: (r: EngineResponse) => void): Promise<MainThreadEngine> => {
    starts++;
    post = p;
    return (message) => {
      sent.push(message);
      if (message.type === "league") p({ type: "league", id: message.id, result: result(`main ${message.id}`) });
      if (message.type === "analyze") p({ type: "analysis", id: message.id, result: analysis });
    };
  };
  return {
    sent,
    start,
    post: (r: EngineResponse) => post(r),
    get starts() {
      return starts;
    },
  };
}

describe("createEngineClient: the League model", () => {
  it("starts one worker on the first request and matches replies to requests by id", async () => {
    const worker = new FakeWorker();
    let made = 0;
    const client = createEngineClient({
      createWorker: () => {
        made++;
        return worker;
      },
    });
    expect(made).toBe(0);
    const a = client.buildLeague(job("1"));
    const b = client.buildLeague(job("2"));
    expect(made).toBe(1);
    expect(worker.posted.map((p) => [p.type, p.id, "myTeamId" in p ? p.myTeamId : null])).toEqual([
      ["league", 1, "1"],
      ["league", 2, "2"],
    ]);
    // Replies arrive out of order; each settles its own request.
    worker.reply({ type: "league", id: 2, result: result("b") });
    worker.reply({ type: "league", id: 1, result: result("a") });
    await expect(a).resolves.toMatchObject({ label: "a" });
    await expect(b).resolves.toMatchObject({ label: "b" });
  });

  it("sends the league's settings with the request (Phase 4 L12), as the page gave them", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    const settings = { ...defaultTradeSettings(), streamPositions: ["K" as const], playoffWeight: 2 };
    const p = client.buildLeague({ ...job(), settings });
    expect(worker.posted[0]).toMatchObject({ type: "league", id: 1, settings });
    worker.reply({ type: "league", id: 1, result: result("a") });
    await expect(p).resolves.toMatchObject({ label: "a" });
  });

  it("rejects with the engine's message, keeping the detail for the console", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    const p = client.buildLeague(job());
    worker.reply({ type: "error", id: 1, message: "Something went wrong while crunching the numbers.", detail: "TypeError: boom" });
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect(err).toMatchObject({ message: "Something went wrong while crunching the numbers.", detail: "TypeError: boom", cancelled: false });
  });

  it("ignores replies nobody waits for, and anything that isn't a reply; a reply of the wrong kind is an error", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    const p = client.buildLeague(job());
    worker.reply({ type: "league", id: 99, result: result("stray") });
    worker.reply("hello");
    worker.reply({ id: 1, type: "draft" });
    worker.reply({ type: "league", id: 1, result: result("mine") });
    await expect(p).resolves.toMatchObject({ label: "mine" });
    const q = client.buildLeague(job());
    worker.reply({ type: "trades", id: 2, result: searchResult("x") });
    await expect(q).rejects.toMatchObject({ detail: 'Unexpected "trades" reply.' });
  });

  it("runs on the main thread when the browser has no Worker", async () => {
    const main = mainThreadEngine();
    const client = createEngineClient({ createWorker: () => null, startMainThread: main.start });
    await expect(client.buildLeague(job())).resolves.toMatchObject({ label: "main 1" });
    await expect(client.buildLeague(job())).resolves.toMatchObject({ label: "main 2" });
    expect(main.sent.map((c) => c.id)).toEqual([1, 2]);
    expect(main.starts).toBe(1); // one engine on the main thread, kept (its cached context with it)
  });

  it("runs on the main thread when the worker can't be created", async () => {
    const main = mainThreadEngine();
    const client = createEngineClient({
      createWorker: () => {
        throw new Error("SecurityError");
      },
      startMainThread: main.start,
    });
    await expect(client.buildLeague(job())).resolves.toMatchObject({ label: "main 1" });
  });

  it("finishes pending requests on the main thread when the worker fails, and stays there", async () => {
    const worker = new FakeWorker();
    const main = mainThreadEngine();
    let made = 0;
    const client = createEngineClient({
      createWorker: () => {
        made++;
        return worker;
      },
      startMainThread: main.start,
    });
    const a = client.buildLeague(job());
    worker.crash();
    await expect(a).resolves.toMatchObject({ label: "main 1" });
    expect(worker.terminated).toBe(true);
    await expect(client.buildLeague(job())).resolves.toMatchObject({ label: "main 2" });
    expect(made).toBe(1);
    expect(worker.posted).toHaveLength(1);
  });

  it("runs a request the worker can't take (not cloneable) on the main thread", async () => {
    const worker = new FakeWorker();
    worker.postMessage = () => {
      throw new Error("DataCloneError");
    };
    const main = mainThreadEngine();
    const client = createEngineClient({ createWorker: () => worker, startMainThread: main.start });
    await expect(client.buildLeague(job())).resolves.toMatchObject({ label: "main 1" });
    expect(worker.terminated).toBe(false);
  });

  it("says so when the main-thread fallback itself fails", async () => {
    const client = createEngineClient({ createWorker: () => null, startMainThread: () => Promise.reject(new Error("ChunkLoadError")) });
    const err = await client.buildLeague(job()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).message).toMatch(/couldn't start the number cruncher/);
    expect((err as EngineError).detail).toContain("ChunkLoadError");
  });

  it("stops the worker on dispose: pending requests reject, late replies and new requests don't run", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    const p = client.buildLeague(job());
    client.dispose();
    expect(worker.terminated).toBe(true);
    await expect(p).rejects.toMatchObject({ message: ENGINE_STOPPED, cancelled: true });
    worker.reply({ type: "league", id: 1, result: result("late") });
    await expect(client.buildLeague(job())).rejects.toMatchObject({ message: ENGINE_STOPPED });
    await expect(client.analyzeTrade({ ...job(), proposal: { partnerId: "2", give: [], get: [] } })).rejects.toMatchObject({ message: ENGINE_STOPPED });
    await expect(client.searchTrades(tradesJob()).promise).rejects.toMatchObject({ message: ENGINE_STOPPED });
    expect(worker.posted).toHaveLength(1);
  });

  it("drops a main-thread result that finishes after dispose", async () => {
    let post: (r: EngineResponse) => void = () => {};
    const client = createEngineClient({
      createWorker: () => null,
      startMainThread: async (p) => {
        post = p;
        return () => {};
      },
    });
    const p = client.buildLeague(job());
    const outcome = expect(p).rejects.toMatchObject({ message: ENGINE_STOPPED });
    await flush();
    client.dispose();
    post({ type: "league", id: 1, result: result("late") });
    await flush();
    await outcome;
  });
});

describe("createEngineClient: the trade search (M12)", () => {
  it("sends the search with the job, reports each progress step, and resolves with the result", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    const seen: string[] = [];
    const search = client.searchTrades(tradesJob("5"), (p) => seen.push(`${p.stage} ${p.done}/${p.total}`));
    expect(worker.posted[0]).toMatchObject({ type: "trades", id: 1, partnerId: "5", myTeamId: "1", nowIso: "2026-09-30T02:00:00.000Z" });
    worker.reply({ type: "progress", id: 1, progress: { stage: "setup", done: 0, total: 1 } });
    worker.reply({ type: "progress", id: 1, progress: { stage: "screening", done: 120, total: 480 } });
    worker.reply({ type: "trades", id: 1, result: searchResult("found") });
    await expect(search.promise).resolves.toMatchObject({ notes: ["found"] });
    expect(seen).toEqual(["setup 0/1", "screening 120/480"]);
    // Stop after it settled does nothing.
    search.cancel();
    expect(worker.posted).toHaveLength(1);
  });

  it("stops at Stop: rejects as cancelled at once, tells the worker, and ignores what the worker still sends", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    const seen: number[] = [];
    const search = client.searchTrades(tradesJob(), (p) => seen.push(p.done));
    worker.reply({ type: "progress", id: 1, progress: { stage: "screening", done: 1, total: 9 } });
    search.cancel();
    const err = await search.promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect(err).toMatchObject({ message: SEARCH_CANCELLED, cancelled: true });
    expect(worker.posted.map((m) => [m.type, m.id])).toEqual([
      ["trades", 1],
      ["cancel", 1],
    ]);
    worker.reply({ type: "progress", id: 1, progress: { stage: "screening", done: 2, total: 9 } });
    worker.reply({ type: "cancelled", id: 1 });
    expect(seen).toEqual([1]);
  });

  it("runs one search at a time: a newer search stops the older one (cancelled), and only the newer one's replies count", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    const first = client.searchTrades(tradesJob());
    const second = client.searchTrades(tradesJob("4"));
    await expect(first.promise).rejects.toMatchObject({ cancelled: true });
    expect(worker.posted.map((m) => [m.type, m.id])).toEqual([
      ["trades", 1],
      ["cancel", 1],
      ["trades", 2],
    ]);
    worker.reply({ type: "trades", id: 1, result: searchResult("old") });
    worker.reply({ type: "trades", id: 2, result: searchResult("new") });
    await expect(second.promise).resolves.toMatchObject({ notes: ["new"] });
    // A League model request alongside doesn't stop a search.
    const third = client.searchTrades(tradesJob());
    const league = client.buildLeague(job());
    worker.reply({ type: "league", id: 4, result: result("l") });
    worker.reply({ type: "trades", id: 3, result: searchResult("third") });
    await expect(league).resolves.toMatchObject({ label: "l" });
    await expect(third.promise).resolves.toMatchObject({ notes: ["third"] });
  });

  it("rejects as cancelled when the worker says it stopped the search, and as an error when it failed", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    const a = client.searchTrades(tradesJob());
    worker.reply({ type: "cancelled", id: 1 });
    await expect(a.promise).rejects.toMatchObject({ message: SEARCH_CANCELLED, cancelled: true });
    const b = client.searchTrades(tradesJob());
    worker.reply({ type: "error", id: 2, message: "Something went wrong while crunching the numbers.", detail: "RangeError: x" });
    await expect(b.promise).rejects.toMatchObject({ detail: "RangeError: x", cancelled: false });
  });

  it("searches on the main thread without a worker: progress and the result come through, and Stop reaches it", async () => {
    const main = mainThreadEngine();
    const client = createEngineClient({ createWorker: () => null, startMainThread: main.start });
    const seen: string[] = [];
    const a = client.searchTrades(tradesJob(), (p) => seen.push(p.stage));
    await flush();
    expect(main.sent.map((m) => [m.type, m.id])).toEqual([["trades", 1]]);
    main.post({ type: "progress", id: 1, progress: { stage: "exact", done: 3, total: 200 } });
    main.post({ type: "trades", id: 1, result: searchResult("main") });
    await expect(a.promise).resolves.toMatchObject({ notes: ["main"] });
    expect(seen).toEqual(["exact"]);
    const b = client.searchTrades(tradesJob());
    await flush();
    b.cancel();
    await expect(b.promise).rejects.toMatchObject({ cancelled: true });
    await flush();
    expect(main.sent.map((m) => [m.type, m.id])).toEqual([
      ["trades", 1],
      ["trades", 2],
      ["cancel", 2],
    ]);
  });

  it("never starts a search on the main thread that was stopped while the engine loaded", async () => {
    const main = mainThreadEngine();
    const client = createEngineClient({ createWorker: () => null, startMainThread: main.start });
    const a = client.searchTrades(tradesJob());
    a.cancel();
    await expect(a.promise).rejects.toMatchObject({ cancelled: true });
    await flush();
    expect(main.sent.filter((m) => m.type === "trades")).toEqual([]);
  });

  it("runs a search again on the main thread when the worker crashes during it, and keeps reporting progress", async () => {
    const worker = new FakeWorker();
    const main = mainThreadEngine();
    const client = createEngineClient({ createWorker: () => worker, startMainThread: main.start });
    const seen: number[] = [];
    const a = client.searchTrades(tradesJob("3"), (p) => seen.push(p.done));
    worker.reply({ type: "progress", id: 1, progress: { stage: "screening", done: 10, total: 100 } });
    worker.crash();
    await flush();
    expect(main.sent[0]).toMatchObject({ type: "trades", id: 1, partnerId: "3" });
    main.post({ type: "progress", id: 1, progress: { stage: "setup", done: 0, total: 1 } });
    main.post({ type: "trades", id: 1, result: searchResult("after crash") });
    await expect(a.promise).resolves.toMatchObject({ notes: ["after crash"] });
    expect(seen).toEqual([10, 0]);
  });

  it("tells a main-thread search to stop on dispose (it can't be terminated like a worker)", async () => {
    const main = mainThreadEngine();
    const client = createEngineClient({ createWorker: () => null, startMainThread: main.start });
    const a = client.searchTrades(tradesJob());
    await flush();
    client.dispose();
    await expect(a.promise).rejects.toMatchObject({ message: ENGINE_STOPPED, cancelled: true });
    await flush();
    expect(main.sent.map((m) => m.type)).toEqual(["trades", "cancel"]);
  });
});

describe("createEngineClient: the Trade Analyzer", () => {
  it("sends the proposal and resolves with the analysis and my odds before any trade; an engine error rejects", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    const proposal = { partnerId: "2", give: [{ kind: "player" as const, id: "101" }], get: [] };
    const a = client.analyzeTrade({ ...job(), proposal });
    expect(worker.posted[0]).toMatchObject({ type: "analyze", id: 1, proposal });
    worker.reply({ type: "analysis", id: 1, result: analysis });
    await expect(a).resolves.toEqual(analysis);
    const b = client.analyzeTrade({ ...job(), proposal });
    worker.reply({ type: "error", id: 2, message: "Something went wrong while crunching the numbers." });
    await expect(b).rejects.toBeInstanceOf(EngineError);
  });

  it("runs on the main thread without a worker", async () => {
    const main = mainThreadEngine();
    const client = createEngineClient({ createWorker: () => null, startMainThread: main.start });
    await expect(client.analyzeTrade({ ...job(), proposal: { partnerId: "2", give: [], get: [] } })).resolves.toEqual(analysis);
  });
});
