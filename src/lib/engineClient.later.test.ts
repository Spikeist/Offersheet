/**
 * The engine client's "now or after this week" lines (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.2; engineClient.ts's
 * header): the worker's `later` replies are filed by the result the client handed out for that request, as they come (a new
 * LaterLines each time, `done` with the last), read with laterLinesOf and heard with watchLaterLines; none for a result without
 * cards, nor for a request no result was handed out under; a re-filter's result has its own; the main thread's engine files
 * them the same way; a disposed client files no more. A fake worker stands in (Vitest runs in Node).
 */
import { describe, expect, it } from "vitest";
import { defaultTradeSettings } from "@/engine/settings";
import type { TradeEvaluation, TradeSearchResult } from "@/engine/tradeModel";
import type { EngineRequest, EngineResponse } from "@/workers/engine.worker";
import { createEngineClient, laterLinesOf, watchLaterLines, type MainThreadEngine, type TradesJob, type WorkerLike } from "./engineClient";

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: EngineRequest[] = [];
  postMessage(message: EngineRequest): void {
    this.posted.push(message);
  }
  terminate(): void {}
  reply(response: unknown): void {
    this.onmessage?.({ data: response } as MessageEvent);
  }
}

const job: TradesJob = { snapshot: { leagueId: "4242" } as never, model: { version: 1 } as never, myTeamId: "1", nowIso: "2026-10-14T21:00:00.000Z", settings: defaultTradeSettings(), partnerId: null };
const card = (key: string) => ({ key }) as unknown as TradeEvaluation;
const result = (keys: string[], both: string[] = []) =>
  ({ trades: keys.map(card), notes: [], ...(both.length ? { helpsBoth: { trades: both.map(card) } } : {}) }) as unknown as TradeSearchResult;
const numbers = (n: number) => ({ b: n / 10, tradeScore: n });

describe("the client's 'now or after this week' lines (Checkpoint 7e, item 4.2)", () => {
  it("files a search's lines by the result it handed out, as they come, a new LaterLines each time, done with the last", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    const handle = client.searchTrades(job);
    const sent = worker.posted[0] as EngineRequest & { id: number };
    const r = result(["a", "b"], ["c"]);
    worker.reply({ type: "trades", id: sent.id, result: r });
    const got = await handle.promise;
    expect(got).toBe(r);
    // Coming: none yet.
    const first = laterLinesOf(r);
    expect(first).toEqual({ lines: new Map(), done: false });
    let heard = 0;
    const stop = watchLaterLines(r, () => heard++);
    worker.reply({ type: "later", id: sent.id, result: [{ key: "a", later: numbers(37) }], done: false });
    const second = laterLinesOf(r);
    expect(second).not.toBe(first);
    expect(second?.lines.get("a")).toEqual(numbers(37));
    expect(second?.done).toBe(false);
    expect(heard).toBe(1);
    worker.reply({ type: "later", id: sent.id, result: [{ key: "b", later: null }, { key: "c", later: numbers(41) }], done: true });
    const last = laterLinesOf(r);
    expect([...(last?.lines.entries() ?? [])]).toEqual([
      ["a", numbers(37)],
      ["b", null],
      ["c", numbers(41)],
    ]);
    expect(last?.done).toBe(true);
    expect(heard).toBe(2);
    // Once done, a stray reply under the same id is ignored; and a watcher that stopped hears nothing.
    stop();
    worker.reply({ type: "later", id: sent.id, result: [{ key: "a", later: numbers(1) }], done: true });
    expect(laterLinesOf(r)).toBe(last);
    expect(heard).toBe(2);
  });

  it("files none for a result without cards, nor for a request no result was handed out under", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    const empty = client.searchTrades(job);
    const r = result([]);
    worker.reply({ type: "trades", id: 1, result: r });
    await empty.promise;
    worker.reply({ type: "later", id: 1, result: [{ key: "a", later: numbers(5) }], done: true });
    expect(laterLinesOf(r)).toBeNull();
    // A search stopped before it answered: its lines (none should come) have no result to go to.
    const stopped = client.searchTrades(job);
    stopped.cancel();
    await expect(stopped.promise).rejects.toMatchObject({ cancelled: true });
    worker.reply({ type: "later", id: 2, result: [{ key: "a", later: numbers(5) }], done: true });
    // Nothing else settles or breaks: the next search answers as usual.
    const next = client.searchTrades(job);
    const r3 = result(["z"]);
    worker.reply({ type: "trades", id: 3, result: r3 });
    await expect(next.promise).resolves.toBe(r3);
    expect(laterLinesOf(r3)?.done).toBe(false);
  });

  it("gives a re-filter's result lines of its own, under the re-filter's id", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    const s = client.searchTrades(job);
    const r1 = result(["a", "b"]);
    worker.reply({ type: "trades", id: 1, result: r1 });
    await s.promise;
    const f = client.refilterTrades({ ...job, result: r1 });
    expect(worker.posted[1]).toMatchObject({ type: "refilter", id: 2, of: 1 });
    const r2 = result(["b"]);
    worker.reply({ type: "trades", id: 2, result: r2 });
    await f.promise;
    worker.reply({ type: "later", id: 2, result: [{ key: "b", later: numbers(20) }], done: true });
    worker.reply({ type: "later", id: 1, result: [{ key: "a", later: numbers(10) }], done: false });
    expect(laterLinesOf(r2)).toEqual({ lines: new Map([["b", numbers(20)]]), done: true });
    expect(laterLinesOf(r1)).toEqual({ lines: new Map([["a", numbers(10)]]), done: false });
  });

  it("files the main thread engine's lines the same way, and a disposed client files no more", async () => {
    let post: (r: EngineResponse) => void = () => {};
    const client = createEngineClient({
      createWorker: () => null,
      startMainThread: async (p): Promise<MainThreadEngine> => {
        post = p;
        return () => {};
      },
    });
    const s = client.searchTrades(job);
    await new Promise((r) => setTimeout(r, 0));
    const r = result(["a", "b"]);
    post({ type: "trades", id: 1, result: r });
    await s.promise;
    post({ type: "later", id: 1, result: [{ key: "a", later: numbers(30) }], done: false });
    expect(laterLinesOf(r)?.lines.get("a")).toEqual(numbers(30));
    client.dispose();
    post({ type: "later", id: 1, result: [{ key: "b", later: numbers(31) }], done: true });
    expect(laterLinesOf(r)?.lines.has("b")).toBe(false);
    expect(laterLinesOf(r)?.done).toBe(false);
  });
});
