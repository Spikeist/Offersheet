/**
 * The engine client's "How to offer it" (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1; engineClient.ts's header):
 * offers(job) sends an `offers` request with the card's source and resolves with the worker's ladder (replies matched by id),
 * rejects with an EngineError on an error reply and once the client is stopped; searchResultIdOf gives the id the worker knows
 * a result by (the search's or re-filter's request id), -1 for a result this client didn't hand out; the main thread's engine
 * answers the same way when there's no worker. A fake worker stands in (Vitest runs in Node).
 */
import { describe, expect, it } from "vitest";
import { defaultTradeSettings } from "@/engine/settings";
import type { OfferLadder, TradeEvaluation, TradeProposal, TradeSearchResult } from "@/engine/tradeModel";
import type { EngineRequest, EngineResponse, OffersRequest } from "@/workers/engine.worker";
import { ENGINE_STOPPED, EngineError, createEngineClient, searchResultIdOf, type MainThreadEngine, type OffersJob, type TradesJob, type WorkerLike } from "./engineClient";

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

const league = { snapshot: { leagueId: "4242" } as never, model: { version: 1 } as never, myTeamId: "1", nowIso: "2026-10-14T21:00:00.000Z", settings: defaultTradeSettings() };
const job: TradesJob = { ...league, partnerId: null };
const proposal: TradeProposal = { partnerId: "6", give: [{ kind: "player", id: "101" }], get: [{ kind: "player", id: "202" }, { kind: "player", id: "203" }] };
const card = (key: string) => ({ key }) as unknown as TradeEvaluation;
const result = (keys: string[]) => ({ trades: keys.map(card), notes: [] }) as unknown as TradeSearchResult;
const ladder = (cardKey: string): OfferLadder => ({ cardKey, steps: [{ kind: "suggested", evaluation: card(cardKey), message: "Hey!" }] });

describe("the client's 'How to offer it' (Checkpoint 7e, item 4.1)", () => {
  it("sends a Finder card's source (its result's request id and key) and resolves with the ladder its reply carries", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    const search = client.searchTrades(job);
    const r = result(["6|give:101|get:202,203"]);
    worker.reply({ type: "trades", id: 1, result: r });
    await search.promise;
    expect(searchResultIdOf(client, r)).toBe(1);
    const asked: OffersJob = { ...league, source: { kind: "search", resultId: searchResultIdOf(client, r), key: "6|give:101|get:202,203" } };
    const pending = client.offers(asked);
    const sent = worker.posted[1] as OffersRequest;
    expect(sent).toEqual({ type: "offers", id: 2, ...asked });
    // A reply to another request doesn't settle it; its own does.
    worker.reply({ type: "offers", id: 99, result: ladder("other") });
    const want = ladder("6|give:101|get:202,203");
    worker.reply({ type: "offers", id: 2, result: want });
    await expect(pending).resolves.toBe(want);
  });

  it("sends the Analyzer's card by its proposal", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    const pending = client.offers({ ...league, source: { kind: "analysis", proposal } });
    expect(worker.posted[0]).toMatchObject({ type: "offers", id: 1, source: { kind: "analysis", proposal } });
    worker.reply({ type: "offers", id: 1, result: ladder("6|give:101|get:202,203") });
    await expect(pending).resolves.toEqual(ladder("6|give:101|get:202,203"));
  });

  it("rejects with an EngineError on an error reply or another reply, and once the client is stopped", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    const failing = client.offers({ ...league, source: { kind: "analysis", proposal } });
    worker.reply({ type: "error", id: 1, message: "Something went wrong.", detail: "RangeError: nope" });
    await expect(failing).rejects.toMatchObject({ name: "EngineError", message: "Something went wrong.", detail: "RangeError: nope", cancelled: false });
    const odd = client.offers({ ...league, source: { kind: "analysis", proposal } });
    worker.reply({ type: "waivers", id: 2, result: null });
    await expect(odd).rejects.toBeInstanceOf(EngineError);
    // Waiting when the client stops: it rejects as stopped; asked after: the same at once.
    const waiting = client.offers({ ...league, source: { kind: "analysis", proposal } });
    client.dispose();
    await expect(waiting).rejects.toMatchObject({ message: ENGINE_STOPPED, cancelled: true });
    await expect(client.offers({ ...league, source: { kind: "analysis", proposal } })).rejects.toMatchObject({ message: ENGINE_STOPPED, cancelled: true });
  });

  it("searchResultIdOf: a re-filter's result by the re-filter's id; -1 for a result another client handed out, or none did", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    const s = client.searchTrades(job);
    const r1 = result(["a"]);
    worker.reply({ type: "trades", id: 1, result: r1 });
    await s.promise;
    const f = client.refilterTrades({ ...job, result: r1 });
    const r2 = result(["a"]);
    worker.reply({ type: "trades", id: 2, result: r2 });
    await f.promise;
    expect([searchResultIdOf(client, r1), searchResultIdOf(client, r2)]).toEqual([1, 2]);
    const other = createEngineClient({ createWorker: () => new FakeWorker() });
    expect(searchResultIdOf(other, r1)).toBe(-1);
    expect(searchResultIdOf(client, result(["a"]))).toBe(-1);
  });

  it("asks the main thread's engine when there's no worker, and resolves the same way", async () => {
    const seen: EngineRequest[] = [];
    let post: (r: EngineResponse) => void = () => {};
    const client = createEngineClient({
      createWorker: () => null,
      startMainThread: async (p): Promise<MainThreadEngine> => {
        post = p;
        return (message) => void seen.push(message);
      },
    });
    const pending = client.offers({ ...league, source: { kind: "search", resultId: -1, key: "6|give:101|get:202,203" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen[0]).toMatchObject({ type: "offers", id: 1, source: { kind: "search", resultId: -1 } });
    post({ type: "offers", id: 1, result: ladder("6|give:101|get:202,203") });
    await expect(pending).resolves.toEqual(ladder("6|give:101|get:202,203"));
  });
});
